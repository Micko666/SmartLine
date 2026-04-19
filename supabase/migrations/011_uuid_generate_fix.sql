-- ============================================================
-- 011_uuid_generate_fix.sql
--
-- Fixes: `function uuid_generate_v4() does not exist` at runtime
-- on the customer ordering path.
--
-- Root cause:
--   `atomic_checkout` (and `submit_booking`) are SECURITY DEFINER
--   functions whose bodies called `uuid_generate_v4()`. That helper
--   lives in the `extensions` schema, but `atomic_checkout` sets
--   `search_path = public`, so the identifier was unresolvable inside
--   the function body. `submit_booking` had no explicit search_path
--   which made it fragile (it happened to work only because the
--   session search_path still included `extensions`).
--
--   Postgres 17 ships `gen_random_uuid()` in `pg_catalog`, which is
--   always on the resolution path. Replacing the extension call with
--   the built-in removes the dependency on search_path ordering.
--
-- Scope: function bodies only. Column defaults (`uuid_generate_v4()`
-- in CREATE TABLE DDL) resolve at INSERT time under the caller's
-- session search_path, which still includes `extensions`, so they
-- are unaffected.
-- ============================================================

-- 1. atomic_checkout --------------------------------------------------

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
  v_order_id       uuid := gen_random_uuid();
  v_receipt_id     uuid := gen_random_uuid();
  v_ts             timestamptz := now();
  v_max_prep       int := 0;
  v_estimated_prep int;
  v_table_name     text := p_table_id;
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

  SELECT name INTO v_table_name
    FROM tables
   WHERE id = NULLIF(p_table_id, 'walk-in')::uuid
     AND user_id = v_user_id;
  IF v_table_name IS NULL THEN
    v_table_name := p_table_id;
  END IF;

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


-- 2. submit_booking --------------------------------------------------

CREATE OR REPLACE FUNCTION submit_booking(
  p_restaurant_token text,
  p_date             text,
  p_time_slot        text,
  p_end_time         text,
  p_type             text,
  p_status           text,
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_email   text,
  p_guest_count      int,
  p_package_id       text,
  p_package_name     text,
  p_notes            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid;
  v_event_id uuid := gen_random_uuid();
BEGIN
  SELECT user_id INTO v_user_id
    FROM business_settings
   WHERE restaurant_token = p_restaurant_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Restaurant not found');
  END IF;

  INSERT INTO calendar_events (
    id, user_id, date, time_slot, end_time, type, status,
    customer_name, customer_phone, customer_email, guest_count,
    package_id, package_name, notes, created_by,
    created_at, updated_at
  ) VALUES (
    v_event_id, v_user_id, p_date, p_time_slot, p_end_time,
    COALESCE(NULLIF(p_type, ''), 'reservation'),
    COALESCE(NULLIF(p_status, ''), 'pending'),
    p_customer_name, p_customer_phone, p_customer_email,
    COALESCE(p_guest_count, 1),
    NULLIF(p_package_id, ''), NULLIF(p_package_name, ''),
    COALESCE(p_notes, ''), 'customer',
    now(), now()
  );

  RETURN jsonb_build_object('ok', true, 'eventId', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_booking(
  text, text, text, text, text, text, text, text, text, int, text, text, text
) TO anon, authenticated;
