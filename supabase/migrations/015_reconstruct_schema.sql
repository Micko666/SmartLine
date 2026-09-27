-- Reconstruct objects previously created outside tracked migrations.
-- Safe on existing tenants: no data deletion; additive columns and NOT VALID
-- checks enforce new writes while legacy validation remains a deployment gate.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS ingredients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 name text NOT NULL, unit text NOT NULL DEFAULT 'g', cost_per_unit numeric NOT NULL DEFAULT 0,
 stock numeric, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS kitchen_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 order_id text NOT NULL, order_number int NOT NULL DEFAULT 0,
 type text NOT NULL CHECK(type IN ('waste','remake','delay','note')), notes text NOT NULL DEFAULT '',
 menu_item_id text, menu_item_name text, quantity numeric, estimated_cost numeric,
 station_id text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS map_decorations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
 type text NOT NULL, x double precision, y double precision, w double precision, h double precision,
 floor text, rotation int DEFAULT 0, created_at timestamptz DEFAULT now()
);
ALTER TABLE kitchen_events ADD COLUMN IF NOT EXISTS station_id text;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ingredients','kitchen_events','map_decorations'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_owner') THEN
   EXECUTE format('CREATE POLICY %I ON public.%I TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id)',t||'_owner',t);
  END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['orders','menu_items','tables','calendar_events','kitchen_events'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
  END IF;
 END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_user_status_created ON orders(user_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_items_user_status ON menu_items(user_id,status);
CREATE INDEX IF NOT EXISTS idx_tables_user_number ON tables(user_id,number);
CREATE INDEX IF NOT EXISTS idx_receipts_user_created ON receipts(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kitchen_events_user_created ON kitchen_events(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingredients_user ON ingredients(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_user ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_event_packages_user ON event_packages(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user_session ON stock_reservations(user_id,session_id);
DROP POLICY IF EXISTS anon_select_orders_realtime ON orders;
DROP POLICY IF EXISTS anon_select_tables_realtime ON tables;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS client_order_id uuid;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address text NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_channel text NOT NULL DEFAULT 'dine-in';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'legacy_unverified';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stock_restored_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_actor text;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'legacy_unverified';
CREATE UNIQUE INDEX IF NOT EXISTS orders_client_key ON orders(user_id,client_order_id) WHERE client_order_id IS NOT NULL;
-- Existing served rows retain their operational meaning as completed orders.
UPDATE orders SET status='completed' WHERE status='served';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK(status IN ('paid','preparing','ready','completed','cancelled','refunded'));
ALTER TABLE menu_items ADD CONSTRAINT menu_nonnegative CHECK(price>=0 AND (stock IS NULL OR stock>=0) AND (max_stock IS NULL OR max_stock>=0)) NOT VALID;
ALTER TABLE calendar_events ADD CONSTRAINT booking_positive_guests CHECK(guest_count>0) NOT VALID;
ALTER TABLE event_packages ADD CONSTRAINT package_guest_range CHECK(min_guests>0 AND max_guests>=min_guests) NOT VALID;
ALTER TABLE orders ADD CONSTRAINT orders_payment_method CHECK(payment_method IN ('cash','card','google_pay','apple_pay')) NOT VALID;
ALTER TABLE orders ADD CONSTRAINT orders_payment_state CHECK(payment_status IN ('unpaid','paid','refunded','legacy_unverified'));
ALTER TABLE orders ADD CONSTRAINT orders_channel CHECK(order_channel IN ('dine-in','takeaway','delivery'));
-- Duplicate numbers must be inspected before production application (see preflight).
CREATE UNIQUE INDEX IF NOT EXISTS orders_user_number ON orders(user_id,order_number);
