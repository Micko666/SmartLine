-- ============================================================
-- 019_public_rpc_minimization
--
-- Public (anon) RPCs return explicit, customer-facing JSON shapes only.
--   get_customer_menu : no stations/PINs, no cost/recipe/sales data, no
--                       user_id, active items only, tables reduced to
--                       id/number/name (needed to label a dine-in QR order)
--   get_booking_data  : booking policy subset (no shift templates),
--                       package display fields, future busy slots only
--   get_roster_data   : employee id/name/role/color only (no phone/email),
--                       shifts limited to a -7..+28 day window
--   get_receipt_by_id : adds payment_status
-- All get an explicit search_path. Response keys stay snake_case where the
-- existing TypeScript mappers expect it, so the client contract is additive.
-- ============================================================

CREATE OR REPLACE FUNCTION get_customer_menu(p_restaurant_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bs business_settings%ROWTYPE; v_menu jsonb; v_tables jsonb;
BEGIN
  SELECT * INTO bs FROM business_settings WHERE restaurant_token = p_restaurant_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', mi.id, 'name', mi.name, 'description', mi.description, 'category', mi.category,
      'price', mi.price, 'prep_time', mi.prep_time, 'stock', mi.stock, 'status', mi.status,
      'icon', mi.icon,
      'image_url', CASE WHEN mi.image_url LIKE 'data:%' THEN '' ELSE COALESCE(mi.image_url, '') END,
      'thumbnail_url', CASE WHEN mi.thumbnail_url LIKE 'data:%' THEN '' ELSE COALESCE(mi.thumbnail_url, '') END,
      'tags', COALESCE(mi.tags, '{}'), 'modifiers', COALESCE(mi.modifiers, '[]'::jsonb),
      'sort_order', mi.sort_order, 'allergens', mi.allergens, 'dietary_tags', mi.dietary_tags,
      'calories', mi.calories, 'updated_at', mi.updated_at
    ) ORDER BY mi.sort_order, mi.name), '[]'::jsonb)
    INTO v_menu FROM menu_items mi WHERE mi.user_id = bs.user_id AND mi.status = 'active';

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'name', t.name) ORDER BY t.number), '[]'::jsonb)
    INTO v_tables FROM tables t WHERE t.user_id = bs.user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'business_name', bs.business_name, 'business_type', bs.business_type,
      'currency', bs.currency, 'currency_symbol', bs.currency_symbol,
      'tax_rate', bs.tax_rate, 'tax_display', bs.tax_display, 'language', bs.language,
      'timezone', bs.timezone, 'opening_hours', bs.opening_hours, 'service_mode', bs.service_mode,
      'low_stock_threshold', bs.low_stock_threshold, 'zero_stock_behavior', bs.zero_stock_behavior,
      'logo_url', CASE WHEN bs.logo_url LIKE 'data:%' THEN '' ELSE COALESCE(bs.logo_url, '') END,
      'restaurant_token', bs.restaurant_token,
      'ordering_paused', COALESCE(bs.ordering_paused, false),
      'ordering_paused_message', COALESCE(bs.ordering_paused_message, ''),
      'takeaway_enabled', COALESCE(bs.takeaway_enabled, true),
      'delivery_enabled', COALESCE(bs.delivery_enabled, false),
      'business_hours', bs.business_hours),
    'menuItems', v_menu,
    'tables', v_tables);
END $$;

CREATE OR REPLACE FUNCTION get_booking_data(p_restaurant_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bs business_settings%ROWTYPE; cs jsonb; v_today text; v_packages jsonb; v_events jsonb;
BEGIN
  SELECT * INTO bs FROM business_settings WHERE restaurant_token = p_restaurant_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  cs := COALESCE(bs.calendar_settings, '{}'::jsonb);
  v_today := to_char(now() AT TIME ZONE COALESCE(NULLIF(bs.timezone, ''), 'UTC'), 'YYYY-MM-DD');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', ep.id, 'name', ep.name, 'emoji', ep.emoji, 'description', ep.description,
      'min_guests', ep.min_guests, 'max_guests', ep.max_guests, 'fixed_price', ep.fixed_price,
      'price_per_person', ep.price_per_person, 'duration', ep.duration, 'details', ep.details, 'active', ep.active
    ) ORDER BY ep.name), '[]'::jsonb)
    INTO v_packages FROM event_packages ep WHERE ep.user_id = bs.user_id AND ep.active;

  -- Busy slots for availability only: no ids, no customer data, no history.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', ce.date, 'time_slot', ce.time_slot, 'type', ce.type, 'status', ce.status)), '[]'::jsonb)
    INTO v_events FROM calendar_events ce
   WHERE ce.user_id = bs.user_id AND ce.status IN ('approved', 'pending') AND ce.date >= v_today;

  RETURN jsonb_build_object(
    'ok', true,
    'restaurantName', bs.business_name,
    'timezone', COALESCE(NULLIF(bs.timezone, ''), 'UTC'),
    'calendarSettings', jsonb_build_object(
      'maxEventsPerDay', cs->'maxEventsPerDay', 'requireApproval', cs->'requireApproval',
      'advanceBookingDays', cs->'advanceBookingDays', 'bookingMessage', cs->'bookingMessage',
      'workingDays', cs->'workingDays', 'workingExceptions', cs->'workingExceptions'),
    'eventPackages', v_packages,
    'calendarEvents', v_events);
END $$;

CREATE OR REPLACE FUNCTION get_roster_data(p_restaurant_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE bs business_settings%ROWTYPE; v_today date; v_employees jsonb; v_shifts jsonb;
BEGIN
  SELECT * INTO bs FROM business_settings WHERE restaurant_token = p_restaurant_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  v_today := (now() AT TIME ZONE COALESCE(NULLIF(bs.timezone, ''), 'UTC'))::date;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'role', e.role, 'color', e.color, 'active', e.active) ORDER BY e.name), '[]'::jsonb)
    INTO v_employees FROM employees e WHERE e.user_id = bs.user_id AND e.active;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'date', s.date, 'name', s.name, 'start_time', s.start_time, 'end_time', s.end_time,
      'color', s.color, 'station_id', s.station_id, 'min_staff', s.min_staff, 'notes', s.notes,
      'assignments', s.assignments
    ) ORDER BY s.date, s.start_time), '[]'::jsonb)
    INTO v_shifts FROM shifts s
   WHERE s.user_id = bs.user_id
     AND s.date ~ '^\d{4}-\d{2}-\d{2}$'
     AND s.date::date BETWEEN v_today - 7 AND v_today + 28;

  RETURN jsonb_build_object('ok', true, 'businessName', bs.business_name, 'employees', v_employees, 'shifts', v_shifts);
END $$;

CREATE OR REPLACE FUNCTION get_receipt_by_id(p_receipt_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r receipts%ROWTYPE;
BEGIN
  SELECT * INTO r FROM receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;
  RETURN jsonb_build_object(
    'ok', true, 'id', r.id, 'orderId', r.order_id, 'orderNumber', r.order_number,
    'tableId', r.table_id, 'tableName', r.table_name, 'restaurantName', r.restaurant_name,
    'items', r.items, 'subtotal', r.subtotal, 'taxRate', r.tax_rate, 'taxAmount', r.tax_amount,
    'total', r.total, 'paymentMethod', r.payment_method, 'paymentStatus', r.payment_status,
    'createdAt', r.created_at);
END $$;
