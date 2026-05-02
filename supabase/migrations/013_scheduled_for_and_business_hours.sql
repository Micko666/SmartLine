-- ============================================================
-- 013_scheduled_for_and_business_hours.sql
--
-- Promotes two local-mode-only features to Supabase:
--
--   1. orders.scheduled_for  — requested pickup / delivery time
--      ("YYYY-MM-DD HH:MM").  Previously embedded in notes text;
--      now a first-class column so the kitchen can sort/filter.
--
--   2. business_settings.business_hours  — structured per-day
--      open/close schedule (jsonb array of WorkingDay objects).
--      The order portal uses this to gate ordering and to filter
--      available time slots to the restaurant's open windows.
--      Previously stored only in the TypeScript default; no value
--      was ever persisted or returned to customer-facing pages.
--
-- Changes:
--   1. orders              — add scheduled_for text column
--   2. business_settings   — add business_hours jsonb column
--   3. atomic_checkout     — accept + store p_scheduled_for
--   4. get_customer_menu   — expose business_hours in settings
-- ============================================================


-- 1. Schema ─────────────────────────────────────────────────────────────────

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS scheduled_for text;

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS business_hours jsonb;


-- 2. atomic_checkout — accept scheduled_for ─────────────────────────────────

CREATE OR REPLACE FUNCTION atomic_checkout(
  p_restaurant_token text,
  p_session_id       text,
  p_table_id         text,
  p_payment_method   text,
  p_cart             jsonb,
  p_notes            text,
  p_scheduled_for    text DEFAULT ''
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
  v_order_id       uuid := gen_random_uuid();
  v_receipt_id     uuid := gen_random_uuid();
  v_ts             timestamptz := now();
  v_max_prep       int := 0;
  v_estimated_prep int;
  v_table_name     text := p_table_id;
  v_is_table_uuid  boolean;
  v_scheduled_for  text;
BEGIN
  SELECT * INTO v_settings
    FROM business_settings
   WHERE restaurant_token = p_restaurant_token
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Restaurant not found');
  END IF;

  v_user_id := v_settings.user_id;

  IF COALESCE(v_settings.ordering_paused, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ordering is currently paused');
  END IF;

  DELETE FROM stock_reservations
   WHERE user_id = v_user_id AND expires_at <= now();

  v_is_table_uuid := p_table_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  IF v_is_table_uuid THEN
    SELECT name INTO v_table_name
      FROM tables
     WHERE id = p_table_id::uuid
       AND user_id = v_user_id;
  END IF;

  IF v_table_name IS NULL OR NOT v_is_table_uuid THEN
    v_table_name := CASE p_table_id
      WHEN 'takeaway' THEN 'Takeaway'
      WHEN 'delivery' THEN 'Delivery'
      WHEN 'walk-in'  THEN 'Walk-in'
      ELSE p_table_id
    END;
  END IF;

  -- Normalise scheduled_for: treat empty string as NULL
  v_scheduled_for := NULLIF(TRIM(p_scheduled_for), '');

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
    notes, scheduled_for, estimated_prep_time, prep_time_adjustment,
    created_at, paid_at, updated_at
  ) VALUES (
    v_order_id, v_user_id, v_order_number, p_table_id, v_table_name, v_order_items,
    'paid', v_subtotal, v_tax_rate, v_tax_amount, v_total, p_payment_method,
    p_notes, v_scheduled_for, v_estimated_prep, 0,
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

  IF v_is_table_uuid THEN
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
    'scheduledFor',      v_scheduled_for,
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

GRANT EXECUTE ON FUNCTION atomic_checkout(text, text, text, text, jsonb, text, text)
  TO anon, authenticated;


-- 3. get_customer_menu — expose business_hours ──────────────────────────────

CREATE OR REPLACE FUNCTION get_customer_menu(p_restaurant_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid;
  v_settings jsonb;
  v_menu     jsonb;
  v_tables   jsonb;
BEGIN
  SELECT bs.user_id,
         jsonb_build_object(
           'business_name',           bs.business_name,
           'business_type',           bs.business_type,
           'currency',                bs.currency,
           'currency_symbol',         bs.currency_symbol,
           'tax_rate',                bs.tax_rate,
           'tax_display',             bs.tax_display,
           'language',                bs.language,
           'timezone',                bs.timezone,
           'opening_hours',           bs.opening_hours,
           'service_mode',            bs.service_mode,
           'low_stock_threshold',     bs.low_stock_threshold,
           'zero_stock_behavior',     bs.zero_stock_behavior,
           'app_url',                 bs.app_url,
           'logo_url',                CASE WHEN bs.logo_url LIKE 'data:%' THEN '' ELSE COALESCE(bs.logo_url,'') END,
           'restaurant_token',        bs.restaurant_token,
           'ordering_paused',         COALESCE(bs.ordering_paused, false),
           'ordering_paused_message', COALESCE(bs.ordering_paused_message, ''),
           'takeaway_enabled',        COALESCE(bs.takeaway_enabled, true),
           'delivery_enabled',        COALESCE(bs.delivery_enabled, false),
           'business_hours',          bs.business_hours,
           'stations',                COALESCE(bs.stations, '[]'::jsonb)
         )
    INTO v_user_id, v_settings
    FROM business_settings bs
   WHERE bs.restaurant_token = p_restaurant_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',               mi.id,
        'name',             mi.name,
        'description',      mi.description,
        'category',         mi.category,
        'price',            mi.price,
        'prep_time',        mi.prep_time,
        'stock',            mi.stock,
        'max_stock',        mi.max_stock,
        'status',           mi.status,
        'icon',             mi.icon,
        'image_url',        CASE WHEN mi.image_url LIKE 'data:%' THEN '' ELSE COALESCE(mi.image_url,'') END,
        'thumbnail_url',    CASE WHEN mi.thumbnail_url LIKE 'data:%' THEN '' ELSE COALESCE(mi.thumbnail_url,'') END,
        'tags',             COALESCE(mi.tags, '{}'),
        'modifiers',        COALESCE(mi.modifiers, '[]'::jsonb),
        'sort_order',       mi.sort_order,
        'sales_count',      mi.sales_count,
        'allergens',        mi.allergens,
        'dietary_tags',     mi.dietary_tags,
        'calories',         mi.calories,
        'cost_per_serving', mi.cost_per_serving,
        'recipe',           mi.recipe,
        'created_at',       mi.created_at,
        'updated_at',       mi.updated_at
      )
      ORDER BY mi.sort_order, mi.name
    ),
    '[]'::jsonb
  )
    INTO v_menu
    FROM menu_items mi
   WHERE mi.user_id = v_user_id
     AND mi.status != 'archived';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',         t.id,
        'number',     t.number,
        'name',       t.name,
        'capacity',   t.capacity,
        'status',     t.status,
        'shape',      COALESCE(t.shape, 'square'),
        'zone',       t.zone,
        'floor',      t.floor,
        'rotation',   COALESCE(t.rotation, 0),
        'x',          t.x,
        'y',          t.y,
        'size_scale', COALESCE(t.size_scale, 1),
        'created_at', t.created_at
      )
    ),
    '[]'::jsonb
  )
    INTO v_tables
    FROM tables t
   WHERE t.user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok',        true,
    'userId',    v_user_id,
    'settings',  v_settings,
    'menuItems', v_menu,
    'tables',    v_tables
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_menu(text) TO anon, authenticated;
