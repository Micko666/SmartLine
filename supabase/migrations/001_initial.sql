-- ============================================================
-- SmartLine — Initial Schema
-- Run this in your Supabase SQL editor or via `supabase db push`
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ─── Tables ──────────────────────────────────────────────────────────────────

-- Business settings (one row per authenticated user)
create table if not exists business_settings (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references auth.users on delete cascade,
  business_name        text not null default 'My Restaurant',
  business_type        text default 'Restaurant',
  currency             text default 'EUR',
  currency_symbol      text default '€',
  tax_rate             numeric(5,2) default 10,
  tax_display          text default 'inclusive'
                         check (tax_display in ('inclusive','exclusive','hidden')),
  language             text default 'English',
  timezone             text default 'UTC',
  opening_hours        text default '09:00-22:00',
  service_mode         text default 'dine-in',
  low_stock_threshold  int default 5,
  zero_stock_behavior  text default 'disable'
                         check (zero_stock_behavior in ('hide','disable')),
  app_url              text default '',
  logo_url             text default '',
  restaurant_token     text not null,
  categories           text[] default '{}',
  next_order_number    int default 1001,
  unique (user_id),
  unique (restaurant_token)
);

-- Menu items
create table if not exists menu_items (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null references auth.users on delete cascade,
  name          text not null,
  description   text default '',
  category      text default '',
  price         numeric(10,2) not null,
  prep_time     int default 10,
  stock         int,            -- NULL = unlimited
  max_stock     int,
  status        text default 'active'
                  check (status in ('active','archived','disabled')),
  icon          text default '🍽️',
  image_url     text default '',
  thumbnail_url text default '',
  tags          text[] default '{}',
  modifiers     jsonb default '[]',   -- Modifier[] as JSONB
  sort_order    int default 0,
  sales_count   int default 0,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Tables (dining locations)
create table if not exists tables (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users on delete cascade,
  number     int not null,
  name       text not null,
  capacity   int default 4,
  status     text default 'available'
               check (status in ('available','occupied','reserved')),
  created_at timestamptz default now()
);

-- Orders
create table if not exists orders (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references auth.users on delete cascade,
  order_number         int not null,
  table_id             text,          -- kept as text to allow 'walk-in'
  table_name           text default '',
  items                jsonb not null default '[]',  -- OrderItem[]
  status               text default 'paid'
                         check (status in ('paid','preparing','ready','served','completed','cancelled','refunded')),
  subtotal             numeric(10,2) default 0,
  tax_rate             numeric(5,2) default 0,
  tax_amount           numeric(10,2) default 0,
  total                numeric(10,2) default 0,
  payment_method       text default 'cash',
  notes                text default '',
  estimated_prep_time  int default 15,
  prep_time_adjustment int default 0,
  created_at           timestamptz default now(),
  paid_at              timestamptz default now(),
  updated_at           timestamptz default now()
);

-- Receipts (immutable snapshots — never updated after creation)
create table if not exists receipts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users on delete cascade,
  order_id        uuid references orders on delete set null,
  order_number    int,
  table_id        text,
  table_name      text default '',
  restaurant_name text default '',
  items           jsonb not null default '[]',
  subtotal        numeric(10,2) default 0,
  tax_rate        numeric(5,2) default 0,
  tax_amount      numeric(10,2) default 0,
  total           numeric(10,2) default 0,
  payment_method  text default 'cash',
  created_at      timestamptz default now()
);

-- Stock reservations (5-min TTL, held during payment flow)
create table if not exists stock_reservations (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users on delete cascade,
  session_id  text not null,
  items       jsonb not null default '[]',   -- {menuItemId, quantity}[]
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);
create index if not exists stock_reservations_expires_at on stock_reservations (expires_at);

-- ─── Row-Level Security ──────────────────────────────────────────────────────

alter table business_settings    enable row level security;
alter table menu_items           enable row level security;
alter table tables               enable row level security;
alter table orders               enable row level security;
alter table receipts             enable row level security;
alter table stock_reservations   enable row level security;

-- business_settings
create policy "owner_all_business_settings" on business_settings
  for all using (auth.uid() = user_id);

-- menu_items: owners have full control; anonymous can read active items
create policy "owner_all_menu_items" on menu_items
  for all using (auth.uid() = user_id);

create policy "public_read_active_menu_items" on menu_items
  for select using (status = 'active');

-- tables: owners only
create policy "owner_all_tables" on tables
  for all using (auth.uid() = user_id);

-- orders: owners only
create policy "owner_all_orders" on orders
  for all using (auth.uid() = user_id);

-- receipts: owners only (customer sees receipt via receiptId URL, no auth needed)
create policy "owner_all_receipts" on receipts
  for all using (auth.uid() = user_id);

-- Allow anonymous read of a receipt by ID (customer receipt page)
create policy "public_read_receipt_by_id" on receipts
  for select using (true);

-- stock_reservations: owners only
create policy "owner_all_stock_reservations" on stock_reservations
  for all using (auth.uid() = user_id);

-- ─── Realtime ────────────────────────────────────────────────────────────────
-- Enable Realtime publication for tables the app subscribes to.
-- Run once after creating tables.

alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table menu_items;

-- ─── Atomic Checkout RPC ─────────────────────────────────────────────────────
-- Runs as a single Postgres transaction. Validates stock, deducts it,
-- increments order number, creates order + receipt, marks table occupied,
-- and releases the reservation — all atomically.

create or replace function atomic_checkout(
  p_user_id        uuid,
  p_session_id     text,
  p_table_id       text,
  p_payment_method text,
  p_cart           jsonb,   -- [{menuItemId, quantity, resolvedModifiers}]
  p_notes          text
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_cart_item      jsonb;
  v_item           record;
  v_other_reserved int;
  v_effective      int;
  v_order_items    jsonb := '[]'::jsonb;
  v_order_item     jsonb;
  v_unavailable    text[] := '{}';
  v_item_price     numeric;
  v_line_total     numeric;
  v_subtotal       numeric := 0;
  v_tax_rate       numeric;
  v_tax_amount     numeric;
  v_total          numeric;
  v_settings       record;
  v_order_number   int;
  v_order_id       uuid := uuid_generate_v4();
  v_receipt_id     uuid := uuid_generate_v4();
  v_ts             timestamptz := now();
  v_max_prep       int := 0;
  v_estimated_prep int;
  v_table_name     text := p_table_id;
begin
  -- Lock settings row to serialize concurrent checkouts for this restaurant
  select * into v_settings
    from business_settings
   where user_id = p_user_id
     for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Restaurant settings not found');
  end if;

  -- Purge expired reservations
  delete from stock_reservations
   where user_id = p_user_id and expires_at <= now();

  -- Resolve table name
  select name into v_table_name
    from tables
   where id = p_table_id::uuid and user_id = p_user_id;
  if v_table_name is null then
    v_table_name := p_table_id;
  end if;

  -- Validate and build order items
  for v_cart_item in select * from jsonb_array_elements(p_cart)
  loop
    select * into v_item
      from menu_items
     where id = (v_cart_item->>'menuItemId')::uuid
       and user_id = p_user_id
       for update;

    if not found or v_item.status != 'active' then
      v_unavailable := array_append(v_unavailable,
        coalesce(v_item.name, v_cart_item->>'menuItemId'));
      continue;
    end if;

    -- Stock check
    if v_item.stock is not null then
      select coalesce(sum((ri->>'quantity')::int), 0) into v_other_reserved
        from stock_reservations r,
             jsonb_array_elements(r.items) as ri
       where r.user_id = p_user_id
         and r.session_id != p_session_id
         and r.expires_at > now()
         and (ri->>'menuItemId')::uuid = v_item.id;

      v_effective := v_item.stock - v_other_reserved;

      if v_effective < (v_cart_item->>'quantity')::int then
        v_unavailable := array_append(v_unavailable, v_item.name);
        continue;
      end if;
    end if;

    -- Build order item
    v_item_price := v_item.price + coalesce(
      (select sum((opt->>'priceAdjustment')::numeric)
         from jsonb_array_elements(
           coalesce(v_cart_item->'resolvedModifiers', '[]'::jsonb)
         ) as opt),
      0
    );
    v_line_total := v_item_price * (v_cart_item->>'quantity')::int;

    v_order_item := jsonb_build_object(
      'menuItemId',   v_item.id,
      'menuItemName', v_item.name,
      'menuItemIcon', v_item.icon,
      'quantity',     (v_cart_item->>'quantity')::int,
      'unitPrice',    v_item_price,
      'modifiers',    coalesce(v_cart_item->'resolvedModifiers', '[]'::jsonb),
      'lineTotal',    v_line_total
    );
    v_order_items := v_order_items || jsonb_build_array(v_order_item);
    v_subtotal    := v_subtotal + v_line_total;
    v_max_prep    := greatest(v_max_prep, v_item.prep_time);

    -- Deduct stock
    if v_item.stock is not null then
      update menu_items
         set stock       = stock - (v_cart_item->>'quantity')::int,
             sales_count = sales_count + (v_cart_item->>'quantity')::int,
             updated_at  = v_ts
       where id = v_item.id;
    end if;
  end loop;

  -- Abort if any item was unavailable
  if array_length(v_unavailable, 1) > 0 then
    return jsonb_build_object(
      'success',          false,
      'error',            'Some items are no longer available.',
      'unavailableItems', to_jsonb(v_unavailable)
    );
  end if;

  if jsonb_array_length(v_order_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'Cart is empty');
  end if;

  -- Totals
  v_tax_rate   := v_settings.tax_rate;
  v_tax_amount := case
    when v_settings.tax_display = 'exclusive'
    then v_subtotal * (v_tax_rate / 100)
    else 0
  end;
  v_total := v_subtotal + v_tax_amount;

  -- Estimated prep time
  v_estimated_prep := v_max_prep +
    greatest(0, jsonb_array_length(v_order_items) - 1) * 2;

  -- Claim next order number atomically
  v_order_number := v_settings.next_order_number;
  update business_settings
     set next_order_number = next_order_number + 1
   where user_id = p_user_id;

  -- Create order
  insert into orders (
    id, user_id, order_number, table_id, table_name, items,
    status, subtotal, tax_rate, tax_amount, total, payment_method,
    notes, estimated_prep_time, prep_time_adjustment,
    created_at, paid_at, updated_at
  ) values (
    v_order_id, p_user_id, v_order_number, p_table_id, v_table_name, v_order_items,
    'paid', v_subtotal, v_tax_rate, v_tax_amount, v_total, p_payment_method,
    p_notes, v_estimated_prep, 0,
    v_ts, v_ts, v_ts
  );

  -- Create receipt
  insert into receipts (
    id, user_id, order_id, order_number, table_id, table_name,
    restaurant_name, items, subtotal, tax_rate, tax_amount,
    total, payment_method, created_at
  ) values (
    v_receipt_id, p_user_id, v_order_id, v_order_number, p_table_id, v_table_name,
    v_settings.business_name, v_order_items, v_subtotal, v_tax_rate, v_tax_amount,
    v_total, p_payment_method, v_ts
  );

  -- Mark table occupied (only for real tables, not walk-in)
  if p_table_id != 'walk-in' then
    update tables
       set status = 'occupied'
     where id = p_table_id::uuid and user_id = p_user_id;
  end if;

  -- Release reservation
  delete from stock_reservations
   where user_id = p_user_id and session_id = p_session_id;

  return jsonb_build_object(
    'success',      true,
    'orderId',      v_order_id,
    'receiptId',    v_receipt_id,
    'orderNumber',  v_order_number,
    'tableName',    v_table_name,
    'subtotal',     v_subtotal,
    'taxRate',      v_tax_rate,
    'taxAmount',    v_tax_amount,
    'total',        v_total,
    'estimatedPrepTime', v_estimated_prep,
    'items',        v_order_items,
    'createdAt',    v_ts
  );
end;
$$;
