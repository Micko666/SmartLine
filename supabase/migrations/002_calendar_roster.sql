-- ============================================================
-- SmartLine — Calendar, Event Packages, Employees & Shifts
-- Run in Supabase SQL editor or via `supabase db push`
-- ============================================================

-- ─── Extend business_settings ────────────────────────────────────────────────

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS calendar_settings jsonb DEFAULT '{}';

-- ─── Calendar Events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS calendar_events (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  date             text NOT NULL,
  time_slot        text NOT NULL,
  end_time         text,
  type             text NOT NULL DEFAULT 'reservation'
                     CHECK (type IN ('reservation','private_event','closure')),
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected','cancelled','completed')),
  customer_name    text DEFAULT '',
  customer_phone   text DEFAULT '',
  customer_email   text DEFAULT '',
  guest_count      int  DEFAULT 1,
  package_id       text,
  package_name     text,
  notes            text DEFAULT '',
  closure_reason   text,
  created_by       text DEFAULT 'manager'
                     CHECK (created_by IN ('customer','manager','staff')),
  approved_by      text,
  approved_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calendar_events_user_date ON calendar_events (user_id, date);

-- ─── Event Packages ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_packages (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name             text NOT NULL,
  emoji            text DEFAULT '🎉',
  description      text DEFAULT '',
  min_guests       int  DEFAULT 1,
  max_guests       int  DEFAULT 100,
  fixed_price      numeric(10,2),
  price_per_person numeric(10,2),
  duration         numeric(4,1) DEFAULT 2,
  details          text DEFAULT '',
  active           boolean DEFAULT true,
  created_at       timestamptz DEFAULT now()
);

-- ─── Employees ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name       text NOT NULL,
  role       text DEFAULT '',
  phone      text,
  email      text,
  color      text DEFAULT '#6366f1',
  active     boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- ─── Shifts ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS shifts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  date         text NOT NULL,
  start_time   text NOT NULL,
  end_time     text NOT NULL,
  role         text DEFAULT '',
  employee_ids text[] DEFAULT '{}',
  min_staff    int  DEFAULT 1,
  notes        text DEFAULT '',
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shifts_user_date ON shifts (user_id, date);

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_packages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts          ENABLE ROW LEVEL SECURITY;

-- calendar_events: owners have full control; public can read for availability checks
CREATE POLICY "owner_all_calendar_events" ON calendar_events
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "public_read_calendar_events" ON calendar_events
  FOR SELECT USING (true);

-- event_packages: owners have full control; public can read active packages
CREATE POLICY "owner_all_event_packages" ON event_packages
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "public_read_active_event_packages" ON event_packages
  FOR SELECT USING (active = true);

-- employees: owners only
CREATE POLICY "owner_all_employees" ON employees
  FOR ALL USING (auth.uid() = user_id);

-- shifts: owners have full control; public can read for staff roster page
CREATE POLICY "owner_all_shifts" ON shifts
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "public_read_shifts" ON shifts
  FOR SELECT USING (true);

-- ─── RPC: get_booking_data ────────────────────────────────────────────────────
-- Used by the public customer booking page (/book/:restaurantToken).
-- Returns calendar settings, active packages, and non-sensitive event slots.

CREATE OR REPLACE FUNCTION get_booking_data(p_restaurant_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id        uuid;
  v_cal_settings   jsonb;
  v_packages       jsonb;
  v_events         jsonb;
BEGIN
  SELECT user_id, COALESCE(calendar_settings, '{}'::jsonb)
    INTO v_user_id, v_cal_settings
    FROM business_settings
   WHERE restaurant_token = p_restaurant_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  -- Active event packages (no sensitive data)
  SELECT COALESCE(jsonb_agg(to_jsonb(ep)), '[]'::jsonb)
    INTO v_packages
    FROM event_packages ep
   WHERE ep.user_id = v_user_id AND ep.active = true;

  -- Only expose date + time_slot + type + status (no customer PII)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id',        ce.id,
      'date',      ce.date,
      'time_slot', ce.time_slot,
      'type',      ce.type,
      'status',    ce.status
    )
  ), '[]'::jsonb)
    INTO v_events
    FROM calendar_events ce
   WHERE ce.user_id = v_user_id
     AND ce.status IN ('approved', 'pending');

  RETURN jsonb_build_object(
    'ok',              true,
    'calendarSettings', v_cal_settings,
    'eventPackages',    v_packages,
    'calendarEvents',   v_events
  );
END;
$$;

-- ─── RPC: submit_booking ─────────────────────────────────────────────────────
-- Public (unauthenticated) booking submission from customer booking page.
-- Resolves restaurant by token, then inserts the event under that user.

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
AS $$
DECLARE
  v_user_id  uuid;
  v_event_id uuid := uuid_generate_v4();
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

-- ─── RPC: get_roster_data ─────────────────────────────────────────────────────
-- Used by the public staff roster page (/roster/:restaurantToken).
-- Returns active employees and all shifts for the restaurant.

CREATE OR REPLACE FUNCTION get_roster_data(p_restaurant_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id       uuid;
  v_business_name text;
  v_employees     jsonb;
  v_shifts        jsonb;
BEGIN
  SELECT user_id, business_name
    INTO v_user_id, v_business_name
    FROM business_settings
   WHERE restaurant_token = p_restaurant_token;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(e)), '[]'::jsonb)
    INTO v_employees
    FROM employees e
   WHERE e.user_id = v_user_id AND e.active = true;

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    INTO v_shifts
    FROM shifts s
   WHERE s.user_id = v_user_id;

  RETURN jsonb_build_object(
    'ok',           true,
    'businessName', v_business_name,
    'employees',    v_employees,
    'shifts',       v_shifts
  );
END;
$$;
