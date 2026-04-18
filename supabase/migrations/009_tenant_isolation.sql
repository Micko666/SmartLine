-- ============================================================
-- 009_tenant_isolation.sql
--
-- Closes seven cross-tenant data leaks and one write-abuse hole.
-- Every path that was previously satisfied by a "public_read"
-- policy is now satisfied by a SECURITY DEFINER RPC scoped to a
-- single restaurant_token or receipt id.
--
-- After this migration, no anon caller can read another tenant's
-- rows through the REST API, realtime, or a mis-scoped RPC.
-- ============================================================

-- 1. Drop every leaky public_read policy ---------------------------------------

DROP POLICY IF EXISTS "public_read_business_settings"     ON business_settings;
DROP POLICY IF EXISTS "public_read_calendar_events"       ON calendar_events;
DROP POLICY IF EXISTS "public_read_receipt_by_id"         ON receipts;
DROP POLICY IF EXISTS "public_read_active_menu_items"     ON menu_items;
DROP POLICY IF EXISTS "public_read_tables"                ON tables;
DROP POLICY IF EXISTS "public_read_shifts"                ON shifts;
DROP POLICY IF EXISTS "public_read_active_event_packages" ON event_packages;


-- 2. Rewrite atomic_checkout to take restaurant_token, not p_user_id -----------
--
-- Previous signature accepted p_user_id directly — any anon caller could post
-- a paid order / drain stock against an arbitrary user. New signature resolves
-- user_id from the restaurant_token server-side.

DROP FUNCTION IF EXISTS atomic_checkout(uuid, text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION atomic_checkout(
  p_restaurant_token text,
  p_session_id       text,
  p_table_id         text,
  p_payment_method   text,
  p_cart             jsonb,
  p_notes            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid;
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
BEGIN
  -- Resolve + lock the restaurant's settings row by token (serializes checkouts)
  SELECT * INTO v_settings
    FROM business_settings
   WHERE restaurant_token = p_restaurant_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Restaurant not found');
  END IF;

  v_user_id := v_settings.user_id;

  -- Respect ordering pause
  IF COALESCE(v_settings.ordering_paused, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ordering is currently paused');
  END IF;

  -- Purge expired reservations for this tenant
  DELETE FROM stock_reservations
   WHERE user_id = v_user_id AND expires_at <= now();

  -- Resolve table name (walk-in / takeaway pass through as-is)
  SELECT name INTO v_table_name
    FROM tables
   WHERE id = NULLIF(p_table_id, 'walk-in')::uuid
     AND user_id = v_user_id;
  IF v_table_name IS NULL THEN
    v_table_name := p_table_id;
  END IF;

  -- Validate + build order items
  FOR v_cart_item IN SELECT * FROM jsonb_array_elements(p_cart)
  LOOP
    SELECT * INTO v_item
      FROM menu_items
     WHERE id = (v_cart_item->>'menuItemId')::uuid
       AND user_id = v_user_id
     FOR UPDATE;

    IF NOT FOUND OR v_item.status != 'active' THEN
      v_unavailable := array_append(v_unavailable,
        COALESCE(v_item.name, v_cart_item->>'menuItemId'));
      CONTINUE;
    END IF;

    IF v_item.stock IS NOT NULL THEN
      SELECT COALESCE(SUM((ri->>'quantity')::int), 0) INTO v_other_reserved
        FROM stock_reservations r,
             jsonb_array_elements(r.items) AS ri
       WHERE r.user_id = v_user_id
         AND r.session_id != p_session_id
         AND r.expires_at > now()
         AND (ri->>'menuItemId')::uuid = v_item.id;

      v_effective := v_item.stock - v_other_reserved;

      IF v_effective < (v_cart_item->>'quantity')::int THEN
        v_unavailable := array_append(v_unavailable, v_item.name);
        CONTINUE;
      END IF;
    END IF;

    v_item_price := v_item.price + COALESCE(
      (SELECT SUM((opt->>'priceAdjustment')::numeric)
         FROM jsonb_array_elements(
           COALESCE(v_cart_item->'resolvedModifiers', '[]'::jsonb)
         ) AS opt),
      0
    );
    v_line_total := v_item_price * (v_cart_item->>'quantity')::int;

    v_order_item := jsonb_build_object(
      'menuItemId',   v_item.id,
      'menuItemName', v_item.name,
      'menuItemIcon', v_item.icon,
      'quantity',     (v_cart_item->>'quantity')::int,
      'unitPrice',    v_item_price,
      'modifiers',    COALESCE(v_cart_item->'resolvedModifiers', '[]'::jsonb),
      'lineTotal',    v_line_total
    );
    v_order_items := v_order_items || jsonb_build_array(v_order_item);
    v_subtotal    := v_subtotal + v_line_total;
    v_max_prep    := GREATEST(v_max_prep, v_item.prep_time);

    IF v_item.stock IS NOT NULL THEN
      UPDATE menu_items
         SET stock       = stock - (v_cart_item->>'quantity')::int,
             sales_count = sales_count + (v_cart_item->>'quantity')::int,
             updated_at  = v_ts
       WHERE id = v_item.id;
    END IF;
  END LOOP;

  IF array_length(v_unavailable, 1) > 0 THEN
    RETURN jsonb_build_object(
      'success',          false,
      'error',            'Some items are no longer available.',
      'unavailableItems', to_jsonb(v_unavailable)
    );
  END IF;

  IF jsonb_array_length(v_order_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
  END IF;

  v_tax_rate   := v_settings.tax_rate;
  v_tax_amount := CASE
    WHEN v_settings.tax_display = 'exclusive'
    THEN v_subtotal * (v_tax_rate / 100)
    ELSE 0
  END;
  v_total := v_subtotal + v_tax_amount;

  v_estimated_prep := v_max_prep +
    GREATEST(0, jsonb_array_length(v_order_items) - 1) * 2;

  v_order_number := v_settings.next_order_number;
  UPDATE business_settings
     SET next_order_number = next_order_number + 1
   WHERE user_id = v_user_id;

  INSERT INTO orders (
    id, user_id, order_number, table_id, table_name, items,
    status, subtotal, tax_rate, tax_amount, total, payment_method,
    notes, estimated_prep_time, prep_time_adjustment,
    created_at, paid_at, updated_at
  ) VALUES (
    v_order_id, v_user_id, v_order_number, p_table_id, v_table_name, v_order_items,
    'paid', v_subtotal, v_tax_rate, v_tax_amount, v_total, p_payment_method,
    p_notes, v_estimated_prep, 0,
    v_ts, v_ts, v_ts
  );

  INSERT INTO receipts (
    id, user_id, order_id, order_number, table_id, table_name,
    restaurant_name, items, subtotal, tax_rate, tax_amount,
    total, payment_method, created_at
  ) VALUES (
    v_receipt_id, v_user_id, v_order_id, v_order_number, p_table_id, v_table_name,
    v_settings.business_name, v_order_items, v_subtotal, v_tax_rate, v_tax_amount,
    v_total, p_payment_method, v_ts
  );

  IF p_table_id != 'walk-in' THEN
    UPDATE tables
       SET status = 'occupied'
     WHERE id = p_table_id::uuid AND user_id = v_user_id;
  END IF;

  DELETE FROM stock_reservations
   WHERE user_id = v_user_id AND session_id = p_session_id;

  RETURN jsonb_build_object(
    'success',           true,
    'orderId',           v_order_id,
    'receiptId',         v_receipt_id,
    'orderNumber',       v_order_number,
    'tableName',         v_table_name,
    'subtotal',          v_subtotal,
    'taxRate',           v_tax_rate,
    'taxAmount',         v_tax_amount,
    'total',             v_total,
    'estimatedPrepTime', v_estimated_prep,
    'items',             v_order_items,
    'createdAt',         v_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION atomic_checkout(text, text, text, text, jsonb, text)
  TO anon, authenticated;


-- 3. Fix get_order_status — it referenced a non-existent `settings` table -------

CREATE OR REPLACE FUNCTION get_order_status(
  p_restaurant_token text,
  p_order_number     integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        uuid;
  v_order          record;
  v_business_name  text;
BEGIN
  SELECT user_id, business_name
    INTO v_user_id, v_business_name
    FROM business_settings
   WHERE restaurant_token = p_restaurant_token
   LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT o.id, o.order_number, o.status, o.table_name,
         o.estimated_prep_time, o.prep_time_adjustment,
         o.paid_at, o.created_at
    INTO v_order
    FROM orders o
   WHERE o.user_id = v_user_id
     AND o.order_number = p_order_number
   ORDER BY o.created_at DESC
   LIMIT 1;

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  RETURN jsonb_build_object(
    'ok',                  true,
    'orderNumber',         v_order.order_number,
    'status',              v_order.status,
    'tableName',           v_order.table_name,
    'estimatedPrepTime',   v_order.estimated_prep_time,
    'prepTimeAdjustment',  v_order.prep_time_adjustment,
    'paidAt',              v_order.paid_at,
    'restaurantName',      COALESCE(v_business_name, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_order_status(text, integer) TO anon, authenticated;


-- 4. Add scoped get_receipt_by_id RPC ------------------------------------------
--
-- Replaces the now-gone public_read_receipt_by_id policy. The receipt UUID
-- itself is the capability — it's random (v4) and never leaves the customer's
-- session + URL, so anyone who has the id is entitled to view that receipt.

CREATE OR REPLACE FUNCTION get_receipt_by_id(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt record;
BEGIN
  SELECT r.id, r.order_id, r.order_number, r.table_id, r.table_name,
         r.restaurant_name, r.items, r.subtotal, r.tax_rate, r.tax_amount,
         r.total, r.payment_method, r.created_at
    INTO v_receipt
    FROM receipts r
   WHERE r.id = p_receipt_id
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'id',             v_receipt.id,
    'orderId',        v_receipt.order_id,
    'orderNumber',    v_receipt.order_number,
    'tableId',        v_receipt.table_id,
    'tableName',      v_receipt.table_name,
    'restaurantName', v_receipt.restaurant_name,
    'items',          v_receipt.items,
    'subtotal',       v_receipt.subtotal,
    'taxRate',        v_receipt.tax_rate,
    'taxAmount',      v_receipt.tax_amount,
    'total',          v_receipt.total,
    'paymentMethod',  v_receipt.payment_method,
    'createdAt',      v_receipt.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_receipt_by_id(uuid) TO anon, authenticated;
