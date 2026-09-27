-- ============================================================
-- 023_validate_constraints
--
-- Promotes the NOT VALID checks added in 015 to fully validated
-- constraints. Run supabase/preflight/production_preflight.sql first:
-- it must return 0 for every column. On 2026-09-27 production returned
-- 0 for all checks (read-only run). If data ever violates a rule this
-- migration fails and nothing is changed (the whole file is one txn).
-- ============================================================
ALTER TABLE menu_items      VALIDATE CONSTRAINT menu_nonnegative;
ALTER TABLE calendar_events VALIDATE CONSTRAINT booking_positive_guests;
ALTER TABLE event_packages  VALIDATE CONSTRAINT package_guest_range;
ALTER TABLE orders          VALIDATE CONSTRAINT orders_payment_method;
