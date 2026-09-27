-- ============================================================
-- 021_privilege_hardening
--
-- Least privilege for every function in the public schema.
--   1. Revoke EXECUTE from PUBLIC/anon/authenticated on ALL public functions
--      (Postgres grants EXECUTE to PUBLIC by default, which made internal
--      SECURITY DEFINER helpers such as transition_order_internal(p_user_id)
--      callable by anyone).
--   2. Grant back an explicit allow-list.
--   3. Future functions no longer get PUBLIC EXECUTE by default.
--   4. API roles lose TRUNCATE / REFERENCES / TRIGGER on tables (RLS does
--      not apply to TRUNCATE).
--   5. Every SECURITY DEFINER function must have a fixed search_path
--      (enforced here; the test suite asserts it).
-- ============================================================

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
  END LOOP;
END $$;

-- Customer / public surface (restaurant token, receipt id or station session is the capability).
GRANT EXECUTE ON FUNCTION
  atomic_checkout(text, text, text, text, jsonb, text, text, uuid, text, text, text),
  get_customer_menu(text),
  get_booking_data(text),
  submit_booking(text, uuid, text, text, text, text, text, text, int, uuid, text),
  lookup_booking_status(text, text, text),
  get_roster_data(text),
  get_order_status(text, integer),
  get_receipt_by_id(uuid),
  station_public_config(text, uuid),
  station_login(text, uuid, text),
  station_logout(text),
  station_get_orders(text),
  station_advance_order(text, uuid, text, text),
  station_adjust_prep_time(text, uuid, int),
  station_log_kitchen_event(text, uuid, text, text, uuid, text, int),
  station_set_table_status(text, uuid, text)
TO anon, authenticated;

-- Owner surface (auth.uid() scoped inside each function).
GRANT EXECUTE ON FUNCTION
  advance_order(uuid, text, text),
  cancel_order(uuid),
  adjust_stock(uuid, int),
  patch_settings(jsonb),
  list_stations(),
  upsert_station(jsonb),
  delete_station(uuid)
TO authenticated;

-- Supabase's platform defaults grant EXECUTE on new functions to the API
-- roles explicitly (not only via PUBLIC); remove both for objects created by
-- the migration role. New RPCs must be granted deliberately.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
-- PUBLIC's EXECUTE default is global and cannot be revoked per schema.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- Pin search_path on any remaining SECURITY DEFINER function without one.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prosecdef
             AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', f.sig);
  END LOOP;
END $$;
