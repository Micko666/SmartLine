-- ============================================================
-- 018_station_auth
--
-- Replaces "restaurant_token == station authorization" with real,
-- server-verified station sessions.
--
--   * stations          normalized table, bcrypt pin_hash (pgcrypto)
--   * station_sessions  opaque random token; only its SHA-256 is stored
--   * station_login     PIN check + lockout after 5 failures (15 min)
--   * station_* RPCs    every call requires a valid session and checks the
--                       station's permissions in the database
--   * list/upsert/delete_station for owners (PINs are write-only)
--
-- Backfill: every business_settings.stations element becomes a stations
-- row (same id). Plaintext PINs are hashed, then removed from the jsonb.
-- Expectation: element ids are UUIDs (buildStation uses crypto.randomUUID);
-- elements with non-UUID ids get a fresh id and are reported by the
-- preflight query in docs/stabilization-execution.md.
--
-- Rollback: stations rows keep id/name/role/color/permissions; the old
-- jsonb keeps everything except `pin`. Restoring PINs requires owners to
-- set them again (plaintext is intentionally not recoverable).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS stations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  role            text NOT NULL CHECK (role IN ('kitchen','service','bar','custom')),
  color           text NOT NULL DEFAULT '#64748b' CHECK (length(color) <= 32),
  permissions     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
  pin_hash        text,
  active          boolean NOT NULL DEFAULT true,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stations_user ON stations(user_id);

CREATE TABLE IF NOT EXISTS station_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  station_id   uuid NOT NULL REFERENCES stations ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_station_sessions_expiry ON station_sessions(expires_at);

-- No REST access at all: stations are managed and used only through RPCs.
ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE station_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stations, station_sessions FROM anon, authenticated;

-- ─── Backfill from business_settings.stations ─────────────────────────────────
INSERT INTO stations (id, user_id, name, role, color, permissions, pin_hash, created_at)
SELECT
  CASE WHEN s->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN (s->>'id')::uuid ELSE gen_random_uuid() END,
  bs.user_id,
  left(COALESCE(NULLIF(trim(s->>'name'), ''), 'Station'), 60),
  CASE WHEN s->>'role' IN ('kitchen','service','bar','custom') THEN s->>'role' ELSE 'custom' END,
  COALESCE(NULLIF(s->>'color', ''), '#64748b'),
  CASE WHEN jsonb_typeof(s->'permissions') = 'object' THEN s->'permissions' ELSE '{}'::jsonb END,
  CASE WHEN COALESCE(s->>'pin', '') <> '' THEN extensions.crypt(s->>'pin', extensions.gen_salt('bf', 8)) END,
  COALESCE((s->>'createdAt')::timestamptz, now())
FROM business_settings bs
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(bs.stations) = 'array' THEN bs.stations ELSE '[]'::jsonb END) s
ON CONFLICT (id) DO NOTHING;

-- Plaintext PINs must not survive anywhere.
UPDATE business_settings
   SET stations = (SELECT COALESCE(jsonb_agg(s - 'pin'), '[]'::jsonb) FROM jsonb_array_elements(stations) s)
 WHERE jsonb_typeof(stations) = 'array' AND stations::text LIKE '%"pin"%';

-- ─── Remove the unauthenticated legacy station API (all overloads) ────────────
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('station_get_orders','station_advance_order','station_adjust_prep_time','station_log_kitchen_event')
  LOOP EXECUTE 'DROP FUNCTION ' || f.sig; END LOOP;
END $$;

-- ─── Helpers ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION station_public_json(s stations) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role, 'color', s.color,
    'permissions', s.permissions, 'hasPin', s.pin_hash IS NOT NULL, 'active', s.active, 'createdAt', s.created_at)
$$;

CREATE OR REPLACE FUNCTION station_perm(s stations, p_key text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE((s.permissions ->> p_key)::boolean, false)
$$;

/** Resolves a raw session token to its active station, or raises. Internal only. */
CREATE OR REPLACE FUNCTION station_require_session(p_session_token text) RETURNS stations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE ses station_sessions%ROWTYPE; st stations%ROWTYPE;
BEGIN
  IF p_session_token IS NULL OR length(p_session_token) <> 64 THEN RAISE EXCEPTION 'Station session required'; END IF;
  SELECT * INTO ses FROM station_sessions
   WHERE token_hash = encode(digest(p_session_token, 'sha256'), 'hex') AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'Station session expired'; END IF;
  SELECT * INTO st FROM stations WHERE id = ses.station_id AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Station disabled'; END IF;
  UPDATE station_sessions SET last_seen_at = now() WHERE id = ses.id;
  RETURN st;
END $$;

-- ─── Public bootstrap + login ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION station_public_config(p_restaurant_token text, p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; v_name text;
BEGIN
  SELECT s.* INTO st FROM stations s
    JOIN business_settings bs ON bs.user_id = s.user_id
   WHERE bs.restaurant_token = p_restaurant_token AND s.id = p_station_id AND s.active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Station not found'); END IF;
  SELECT business_name INTO v_name FROM business_settings WHERE user_id = st.user_id;
  RETURN jsonb_build_object('ok', true, 'restaurantName', v_name, 'station', station_public_json(st));
END $$;

CREATE OR REPLACE FUNCTION station_login(p_restaurant_token text, p_station_id uuid, p_pin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE st stations%ROWTYPE; v_token text; v_expires timestamptz := now() + interval '12 hours';
BEGIN
  SELECT s.* INTO st FROM stations s JOIN business_settings bs ON bs.user_id = s.user_id
   WHERE bs.restaurant_token = p_restaurant_token AND s.id = p_station_id AND s.active FOR UPDATE OF s;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Station not found'); END IF;
  IF st.locked_until IS NOT NULL AND st.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Too many attempts. Try again later.', 'lockedUntil', st.locked_until);
  END IF;
  IF st.pin_hash IS NOT NULL AND (p_pin IS NULL OR crypt(p_pin, st.pin_hash) <> st.pin_hash) THEN
    UPDATE stations SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' END
     WHERE id = st.id;
    RETURN jsonb_build_object('ok', false, 'error', 'Incorrect PIN');
  END IF;
  UPDATE stations SET failed_attempts = 0, locked_until = NULL WHERE id = st.id;
  DELETE FROM station_sessions WHERE expires_at <= now();
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO station_sessions (station_id, user_id, token_hash, expires_at)
  VALUES (st.id, st.user_id, encode(digest(v_token, 'sha256'), 'hex'), v_expires);
  RETURN jsonb_build_object('ok', true, 'sessionToken', v_token, 'expiresAt', v_expires, 'station', station_public_json(st));
END $$;

CREATE OR REPLACE FUNCTION station_logout(p_session_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  DELETE FROM station_sessions WHERE token_hash = encode(digest(COALESCE(p_session_token, ''), 'sha256'), 'hex');
  RETURN jsonb_build_object('ok', true);
END $$;

-- ─── Station operations (session + permission checked) ────────────────────────

CREATE OR REPLACE FUNCTION station_get_orders(p_session_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; v_statuses text[]; v_contact boolean; v_orders jsonb;
BEGIN
  st := station_require_session(p_session_token);
  -- Legacy permission payloads may still say 'paid' for the first kitchen state.
  SELECT COALESCE(array_agg(CASE WHEN x = 'paid' THEN 'placed' ELSE x END) FILTER (WHERE x IN ('paid','placed','preparing','ready')), ARRAY['placed','preparing','ready'])
    INTO v_statuses FROM jsonb_array_elements_text(COALESCE(st.permissions->'visibleStatuses', '[]'::jsonb)) x;
  IF cardinality(v_statuses) = 0 THEN v_statuses := ARRAY['placed','preparing','ready']; END IF;
  -- Contact details are only for stations that hand orders over to customers.
  v_contact := st.role IN ('service','custom');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'table_id', o.table_id, 'table_name', o.table_name,
      'items', o.items, 'status', o.status, 'subtotal', o.subtotal, 'tax_rate', o.tax_rate,
      'tax_amount', o.tax_amount, 'total', o.total, 'payment_method', o.payment_method,
      'payment_status', o.payment_status, 'notes', o.notes, 'scheduled_for', o.scheduled_for,
      'order_channel', o.order_channel, 'estimated_prep_time', o.estimated_prep_time,
      'prep_time_adjustment', o.prep_time_adjustment, 'created_at', o.created_at, 'paid_at', o.paid_at,
      'updated_at', o.updated_at, 'customer_name', o.customer_name,
      'customer_phone', CASE WHEN v_contact THEN o.customer_phone ELSE '' END,
      'delivery_address', CASE WHEN v_contact THEN o.delivery_address ELSE '' END
    ) ORDER BY o.created_at), '[]'::jsonb)
    INTO v_orders
    FROM orders o WHERE o.user_id = st.user_id AND o.status = ANY (v_statuses);
  RETURN jsonb_build_object('ok', true, 'orders', v_orders);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION station_advance_order(p_session_token text, p_order_id uuid, p_expected_status text, p_new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; v_actor text;
BEGIN
  st := station_require_session(p_session_token);
  v_actor := 'station:' || st.id;
  IF p_new_status = 'cancelled' THEN
    IF NOT station_perm(st, 'canCancelOrders') THEN RAISE EXCEPTION 'Station may not cancel orders'; END IF;
  ELSIF p_expected_status = 'ready' AND p_new_status = 'preparing' THEN
    IF NOT station_perm(st, 'canReworkOrders') THEN RAISE EXCEPTION 'Station may not send orders back'; END IF;
    RETURN transition_order_internal(st.user_id, p_order_id, p_expected_status, p_new_status, v_actor || ':rework');
  ELSIF p_new_status = 'refunded' THEN
    RAISE EXCEPTION 'Refunds require the owner';
  ELSIF NOT station_perm(st, 'canAdvanceOrders') THEN
    RAISE EXCEPTION 'Station may not advance orders';
  END IF;
  RETURN transition_order_internal(st.user_id, p_order_id, p_expected_status, p_new_status, v_actor);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION station_adjust_prep_time(p_session_token text, p_order_id uuid, p_delta_minutes int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; o orders%ROWTYPE;
BEGIN
  st := station_require_session(p_session_token);
  IF NOT station_perm(st, 'canAdjustPrepTime') THEN RAISE EXCEPTION 'Station may not adjust prep time'; END IF;
  IF p_delta_minutes IS NULL OR abs(p_delta_minutes) > 240 THEN RAISE EXCEPTION 'Invalid prep time adjustment'; END IF;
  UPDATE orders SET prep_time_adjustment = greatest(-60, least(180, COALESCE(prep_time_adjustment, 0) + p_delta_minutes)),
                    updated_at = now(), last_actor = 'station:' || st.id
   WHERE id = p_order_id AND user_id = st.user_id AND status IN ('placed','preparing','ready')
  RETURNING * INTO o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  RETURN jsonb_build_object('ok', true, 'order', to_jsonb(o));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION station_log_kitchen_event(
  p_session_token text, p_order_id uuid, p_type text, p_notes text,
  p_menu_item_id uuid DEFAULT NULL, p_menu_item_name text DEFAULT NULL, p_quantity int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; o orders%ROWTYPE; v_id uuid;
BEGIN
  st := station_require_session(p_session_token);
  IF NOT (station_perm(st, 'canLogKitchenEvents') OR (p_type = 'remake' AND station_perm(st, 'canReworkOrders'))) THEN
    RAISE EXCEPTION 'Station may not log kitchen events';
  END IF;
  IF p_type NOT IN ('waste','remake','delay','note') THEN RAISE EXCEPTION 'Invalid event type'; END IF;
  IF length(COALESCE(p_notes, '')) > 1000 OR length(COALESCE(p_menu_item_name, '')) > 200 THEN RAISE EXCEPTION 'Field too long'; END IF;
  IF p_quantity IS NOT NULL AND (p_quantity < 1 OR p_quantity > 1000) THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
  SELECT * INTO o FROM orders WHERE id = p_order_id AND user_id = st.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found'; END IF;
  IF p_menu_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items WHERE id = p_menu_item_id AND user_id = st.user_id) THEN
    RAISE EXCEPTION 'Menu item not found';
  END IF;
  INSERT INTO kitchen_events (user_id, order_id, order_number, type, notes, menu_item_id, menu_item_name, quantity, station_id)
  VALUES (st.user_id, o.id::text, o.order_number, p_type, COALESCE(p_notes, ''), p_menu_item_id::text, p_menu_item_name, p_quantity, st.id::text)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION station_set_table_status(p_session_token text, p_table_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st stations%ROWTYPE; t tables%ROWTYPE;
BEGIN
  st := station_require_session(p_session_token);
  IF NOT station_perm(st, 'canUpdateTableStatus') THEN RAISE EXCEPTION 'Station may not change table status'; END IF;
  IF p_status NOT IN ('available','occupied','reserved') THEN RAISE EXCEPTION 'Invalid table status'; END IF;
  UPDATE tables SET status = p_status WHERE id = p_table_id AND user_id = st.user_id RETURNING * INTO t;
  IF NOT FOUND THEN RAISE EXCEPTION 'Table not found'; END IF;
  RETURN jsonb_build_object('ok', true, 'table', to_jsonb(t));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

-- ─── Owner management (PIN is write-only) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION list_stations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(station_public_json(s) ORDER BY s.created_at), '[]'::jsonb) FROM stations s WHERE s.user_id = auth.uid());
END $$;

CREATE OR REPLACE FUNCTION upsert_station(p_station jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE st stations%ROWTYPE; v_id uuid; v_pin text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF jsonb_typeof(p_station) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid station'; END IF;
  IF p_station ? 'permissions' AND jsonb_typeof(p_station->'permissions') <> 'object' THEN RAISE EXCEPTION 'Invalid permissions'; END IF;
  v_id := NULLIF(p_station->>'id', '')::uuid;
  IF v_id IS NOT NULL THEN
    SELECT * INTO st FROM stations WHERE id = v_id FOR UPDATE;
    IF FOUND AND st.user_id <> auth.uid() THEN RAISE EXCEPTION 'Station not found'; END IF;
  END IF;
  IF p_station ? 'pin' THEN
    v_pin := COALESCE(p_station->>'pin', '');
    IF v_pin <> '' AND v_pin !~ '^[0-9]{4,6}$' THEN RAISE EXCEPTION 'PIN must be 4 to 6 digits'; END IF;
  END IF;
  INSERT INTO stations (id, user_id, name, role, color, permissions, pin_hash)
  VALUES (COALESCE(v_id, gen_random_uuid()), auth.uid(), trim(p_station->>'name'), p_station->>'role',
          COALESCE(NULLIF(p_station->>'color', ''), '#64748b'), COALESCE(p_station->'permissions', '{}'::jsonb),
          CASE WHEN COALESCE(v_pin, '') <> '' THEN crypt(v_pin, gen_salt('bf', 8)) END)
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, role = EXCLUDED.role, color = EXCLUDED.color, permissions = EXCLUDED.permissions,
    pin_hash = CASE WHEN p_station ? 'pin' THEN EXCLUDED.pin_hash ELSE stations.pin_hash END,
    failed_attempts = CASE WHEN p_station ? 'pin' THEN 0 ELSE stations.failed_attempts END,
    locked_until = CASE WHEN p_station ? 'pin' THEN NULL ELSE stations.locked_until END,
    updated_at = now()
  RETURNING * INTO st;
  -- A PIN change or role change invalidates existing device sessions.
  IF p_station ? 'pin' THEN DELETE FROM station_sessions WHERE station_id = st.id; END IF;
  RETURN jsonb_build_object('ok', true, 'station', station_public_json(st));
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION delete_station(p_station_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM stations WHERE id = p_station_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Station not found'; END IF;
  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END $$;

-- ─── Grants ───────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION station_require_session(text), station_public_json(stations), station_perm(stations, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION station_public_config(text, uuid), station_login(text, uuid, text), station_logout(text),
  station_get_orders(text), station_advance_order(text, uuid, text, text), station_adjust_prep_time(text, uuid, int),
  station_log_kitchen_event(text, uuid, text, text, uuid, text, int), station_set_table_status(text, uuid, text),
  list_stations(), upsert_station(jsonb), delete_station(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION station_public_config(text, uuid), station_login(text, uuid, text), station_logout(text),
  station_get_orders(text), station_advance_order(text, uuid, text, text), station_adjust_prep_time(text, uuid, int),
  station_log_kitchen_event(text, uuid, text, text, uuid, text, int), station_set_table_status(text, uuid, text)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION list_stations(), upsert_station(jsonb), delete_station(uuid) TO authenticated;
