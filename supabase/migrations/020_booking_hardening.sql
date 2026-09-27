-- ============================================================
-- 020_booking_hardening
--
-- Public booking no longer trusts the browser:
--   * status is decided by calendar_settings.requireApproval
--   * customers may only request 'reservation' or 'private_event'
--   * date/time/working day/exceptions/closures/advance window,
--     maxEventsPerDay (serialized by a settings-row lock), package
--     ownership + activity + guest range and field lengths are validated
--   * idempotency: client_request_id (unique per tenant)
--   * every booking gets an 8-character confirmation code; status lookup
--     needs phone + code, so other customers' bookings cannot be enumerated
--
-- Existing rows: new columns are nullable; no data is rewritten.
-- ============================================================

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS confirmation_code text;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_client_request ON calendar_events(user_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS calendar_events_confirmation ON calendar_events(user_id, confirmation_code) WHERE confirmation_code IS NOT NULL;

/** Booking policy with the same defaults the UI uses (src/store/workspace.ts). */
CREATE OR REPLACE FUNCTION booking_policy(p_settings jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'maxEventsPerDay', COALESCE((p_settings->>'maxEventsPerDay')::int, 10),
    'requireApproval', COALESCE((p_settings->>'requireApproval')::boolean, true),
    'advanceBookingDays', COALESCE((p_settings->>'advanceBookingDays')::int, 90),
    'workingDays', CASE WHEN jsonb_typeof(p_settings->'workingDays') = 'array' AND jsonb_array_length(p_settings->'workingDays') > 0
      THEN p_settings->'workingDays'
      ELSE '[{"dayOfWeek":0,"isOpen":false,"openTime":"09:00","closeTime":"22:00"},
             {"dayOfWeek":1,"isOpen":true,"openTime":"09:00","closeTime":"22:00"},
             {"dayOfWeek":2,"isOpen":true,"openTime":"09:00","closeTime":"22:00"},
             {"dayOfWeek":3,"isOpen":true,"openTime":"09:00","closeTime":"22:00"},
             {"dayOfWeek":4,"isOpen":true,"openTime":"09:00","closeTime":"22:00"},
             {"dayOfWeek":5,"isOpen":true,"openTime":"09:00","closeTime":"23:00"},
             {"dayOfWeek":6,"isOpen":true,"openTime":"10:00","closeTime":"23:00"}]'::jsonb END,
    'workingExceptions', CASE WHEN jsonb_typeof(p_settings->'workingExceptions') = 'array' THEN p_settings->'workingExceptions' ELSE '[]'::jsonb END)
$$;

CREATE OR REPLACE FUNCTION normalize_phone(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT regexp_replace(COALESCE(p, ''), '[^0-9]', '', 'g') $$;

DROP FUNCTION IF EXISTS submit_booking(text, text, text, text, text, text, text, text, text, int, text, text, text);

CREATE OR REPLACE FUNCTION submit_booking(
  p_restaurant_token text, p_client_request_id uuid, p_date text, p_time_slot text, p_type text,
  p_customer_name text, p_customer_phone text, p_customer_email text, p_guest_count int,
  p_package_id uuid, p_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  bs business_settings%ROWTYPE; pol jsonb; day jsonb; exc jsonb; pkg event_packages%ROWTYPE;
  ev calendar_events%ROWTYPE; zone text; v_now timestamp; v_date date; v_open int; v_close int; v_slot int;
  v_count int; v_status text; v_code text;
BEGIN
  SELECT * INTO bs FROM business_settings WHERE restaurant_token = p_restaurant_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Restaurant not found'; END IF;
  IF p_client_request_id IS NULL THEN RAISE EXCEPTION 'A request id is required'; END IF;

  SELECT * INTO ev FROM calendar_events WHERE user_id = bs.user_id AND client_request_id = p_client_request_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'eventId', ev.id, 'status', ev.status, 'confirmationCode', ev.confirmation_code);
  END IF;

  IF p_type IS NULL OR p_type NOT IN ('reservation', 'private_event') THEN RAISE EXCEPTION 'Invalid booking type'; END IF;
  IF length(trim(COALESCE(p_customer_name, ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'Name is required'; END IF;
  IF length(normalize_phone(p_customer_phone)) NOT BETWEEN 5 AND 20 OR length(p_customer_phone) > 40 THEN RAISE EXCEPTION 'A valid phone number is required'; END IF;
  IF length(COALESCE(p_customer_email, '')) > 200 OR length(COALESCE(p_notes, '')) > 2000 THEN RAISE EXCEPTION 'Field too long'; END IF;
  IF p_date !~ '^\d{4}-\d{2}-\d{2}$' OR p_time_slot !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN RAISE EXCEPTION 'Invalid date or time'; END IF;
  BEGIN v_date := p_date::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid date'; END;

  pol := booking_policy(bs.calendar_settings);
  zone := COALESCE(NULLIF(bs.timezone, ''), 'UTC');
  v_now := now() AT TIME ZONE zone;
  IF v_date < v_now::date THEN RAISE EXCEPTION 'Date is in the past'; END IF;
  IF (pol->>'advanceBookingDays')::int > 0 AND v_date > v_now::date + (pol->>'advanceBookingDays')::int THEN
    RAISE EXCEPTION 'Date is too far in advance';
  END IF;

  SELECT x INTO exc FROM jsonb_array_elements(pol->'workingExceptions') x WHERE x->>'date' = p_date LIMIT 1;
  SELECT x INTO day FROM jsonb_array_elements(pol->'workingDays') x WHERE (x->>'dayOfWeek')::int = extract(dow FROM v_date)::int LIMIT 1;
  IF exc IS NOT NULL THEN
    IF COALESCE((exc->>'isClosed')::boolean, false) THEN RAISE EXCEPTION 'Closed on this date'; END IF;
  ELSIF day IS NULL OR NOT COALESCE((day->>'isOpen')::boolean, false) THEN
    RAISE EXCEPTION 'Closed on this day';
  END IF;
  v_open  := extract(epoch FROM COALESCE(exc->>'openTime',  day->>'openTime',  '09:00')::time)::int / 60;
  v_close := extract(epoch FROM COALESCE(exc->>'closeTime', day->>'closeTime', '22:00')::time)::int / 60;
  v_slot  := extract(epoch FROM p_time_slot::time)::int / 60;
  -- Same 60-minute grid as BookingPage: open .. close-60.
  IF v_slot < v_open OR v_slot > v_close - 60 OR (v_slot - v_open) % 60 <> 0 THEN RAISE EXCEPTION 'Time is outside booking hours'; END IF;
  IF v_date = v_now::date AND v_slot <= extract(epoch FROM v_now::time)::int / 60 THEN RAISE EXCEPTION 'Time is in the past'; END IF;

  IF EXISTS (SELECT 1 FROM calendar_events WHERE user_id = bs.user_id AND date = p_date AND type = 'closure' AND status = 'approved') THEN
    RAISE EXCEPTION 'Closed on this date';
  END IF;
  IF (pol->>'maxEventsPerDay')::int > 0 THEN
    SELECT count(*) INTO v_count FROM calendar_events
     WHERE user_id = bs.user_id AND date = p_date AND type <> 'closure' AND status IN ('approved', 'pending');
    IF v_count >= (pol->>'maxEventsPerDay')::int THEN RAISE EXCEPTION 'Fully booked on this date'; END IF;
  END IF;

  IF p_package_id IS NOT NULL THEN
    SELECT * INTO pkg FROM event_packages WHERE id = p_package_id AND user_id = bs.user_id AND active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Package not available'; END IF;
    IF p_guest_count IS NULL OR p_guest_count < GREATEST(COALESCE(pkg.min_guests, 1), 1) OR p_guest_count > COALESCE(pkg.max_guests, 500) THEN
      RAISE EXCEPTION 'Guest count is outside the package range';
    END IF;
  ELSIF p_guest_count IS NULL OR p_guest_count NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid guest count';
  END IF;

  v_status := CASE WHEN (pol->>'requireApproval')::boolean THEN 'pending' ELSE 'approved' END;
  v_code := upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 8));

  INSERT INTO calendar_events (user_id, client_request_id, confirmation_code, date, time_slot, type, status,
    customer_name, customer_phone, customer_email, guest_count, package_id, package_name, notes, created_by)
  VALUES (bs.user_id, p_client_request_id, v_code, p_date, p_time_slot, p_type, v_status,
    trim(p_customer_name), trim(p_customer_phone), trim(COALESCE(p_customer_email, '')), p_guest_count,
    pkg.id::text, pkg.name, COALESCE(p_notes, ''), 'customer')
  RETURNING * INTO ev;

  RETURN jsonb_build_object('ok', true, 'eventId', ev.id, 'status', ev.status, 'confirmationCode', ev.confirmation_code);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

/** Status of one's own booking: needs the phone AND the confirmation code. */
CREATE OR REPLACE FUNCTION lookup_booking_status(p_restaurant_token text, p_phone text, p_confirmation_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_rows jsonb;
BEGIN
  SELECT user_id INTO v_user FROM business_settings WHERE restaurant_token = p_restaurant_token;
  IF NOT FOUND OR length(normalize_phone(p_phone)) < 5 OR COALESCE(p_confirmation_code, '') !~* '^[0-9a-f]{8}$' THEN
    RETURN jsonb_build_object('ok', true, 'bookings', '[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('date', date, 'timeSlot', time_slot, 'type', type, 'status', status,
      'packageName', package_name, 'guestCount', guest_count, 'confirmationCode', confirmation_code)), '[]'::jsonb)
    INTO v_rows FROM calendar_events
   WHERE user_id = v_user AND confirmation_code = upper(p_confirmation_code)
     AND normalize_phone(customer_phone) = normalize_phone(p_phone);
  RETURN jsonb_build_object('ok', true, 'bookings', v_rows);
END $$;
