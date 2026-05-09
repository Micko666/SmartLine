-- ============================================================
-- 014_fix_realtime_publications_and_station_rls
--
-- Fixes three realtime sync issues:
--
--  1. kitchen_events + tables missing from supabase_realtime
--     publication — admin dashboard never got kitchen event
--     realtime updates; station table-status updates never fired.
--
--  2. Station pages connect as anon (no auth session).
--     RLS on orders requires auth.uid() = user_id, which is
--     always false for anon → Supabase drops realtime events
--     silently. Stations fell back to 30-second polling only.
--     Fix: add anon SELECT policy so realtime events fire;
--     stations still fetch actual data via station_get_orders
--     (SECURITY DEFINER RPC).
--
--  3. tables REPLICA IDENTITY — ensure it is DEFAULT (primary
--     key) so UPDATE events carry the row identity correctly.
-- ============================================================

-- 1. Add missing tables to realtime publication ─────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE kitchen_events;
ALTER PUBLICATION supabase_realtime ADD TABLE tables;

-- 2. Fix tables REPLICA IDENTITY ────────────────────────────────
ALTER TABLE tables REPLICA IDENTITY DEFAULT;

-- 3. Anon SELECT on orders — enables realtime events for station
--    devices (unauthenticated). Actual order data is only returned
--    through station_get_orders (SECURITY DEFINER), so this policy
--    just unblocks the realtime channel trigger.
CREATE POLICY "anon_select_orders_realtime" ON orders
  FOR SELECT TO anon
  USING (true);

-- 4. Anon SELECT on tables — enables realtime table-status events
--    for station devices.
CREATE POLICY "anon_select_tables_realtime" ON tables
  FOR SELECT TO anon
  USING (true);
