-- Production schema BEFORE migrations 015-024 (public schema only).
-- Captured read-only from the production catalog on 2026-09-27
-- (pg_attribute/pg_constraint/pg_indexes/pg_policies/pg_publication_tables/pg_proc).
-- Contains NO production data. Used only by the upgrade rehearsal
-- (supabase/tests/upgrade-rehearsal.pg.test.ts) on a disposable local server,
-- on top of supabase/tests/support/supabase-shim.sql.
--
-- Function bodies are stubs: 015-024 replace or drop every one of them, so only
-- the identity (name, argument list incl. defaults, result type, SECURITY
-- DEFINER, search_path config, ACL) matters for the upgrade and is exact.
-- Not captured: production row data, auth/storage internals, the
-- backup_20260927 schema (created 2026-09-27, see production-release-readiness.md).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.business_settings (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, business_name text DEFAULT 'My Restaurant'::text NOT NULL, business_type text DEFAULT 'Restaurant'::text, currency text DEFAULT 'EUR'::text, currency_symbol text DEFAULT '€'::text, tax_rate numeric(5,2) DEFAULT 10, tax_display text DEFAULT 'inclusive'::text, language text DEFAULT 'English'::text, timezone text DEFAULT 'UTC'::text, opening_hours text DEFAULT '09:00-22:00'::text, service_mode text DEFAULT 'dine-in'::text, low_stock_threshold integer DEFAULT 5, zero_stock_behavior text DEFAULT 'disable'::text, app_url text DEFAULT ''::text, logo_url text DEFAULT ''::text, restaurant_token text NOT NULL, categories text[] DEFAULT '{}'::text[], next_order_number integer DEFAULT 1001, stations jsonb DEFAULT '[]'::jsonb, calendar_settings jsonb DEFAULT '{}'::jsonb, ordering_paused boolean DEFAULT false, ordering_paused_message text DEFAULT ''::text, takeaway_enabled boolean DEFAULT true, delivery_enabled boolean DEFAULT false, business_hours jsonb);
CREATE TABLE public.calendar_events (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, date text NOT NULL, time_slot text NOT NULL, end_time text, type text DEFAULT 'reservation'::text NOT NULL, status text DEFAULT 'pending'::text NOT NULL, customer_name text DEFAULT ''::text, customer_phone text DEFAULT ''::text, customer_email text DEFAULT ''::text, guest_count integer DEFAULT 1, package_id text, package_name text, notes text DEFAULT ''::text, closure_reason text, created_by text DEFAULT 'manager'::text, approved_by text, approved_at timestamp with time zone, rejection_reason text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());
CREATE TABLE public.employees (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, name text NOT NULL, role text DEFAULT ''::text, phone text, email text, color text DEFAULT '#6366f1'::text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.event_packages (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, name text NOT NULL, emoji text DEFAULT '🎉'::text, description text DEFAULT ''::text, min_guests integer DEFAULT 1, max_guests integer DEFAULT 100, fixed_price numeric(10,2), price_per_person numeric(10,2), duration numeric(4,1) DEFAULT 2, details text DEFAULT ''::text, active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.ingredients (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, name text NOT NULL, unit text DEFAULT 'g'::text NOT NULL, cost_per_unit numeric DEFAULT 0 NOT NULL, stock numeric, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.kitchen_events (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, order_id text NOT NULL, order_number integer DEFAULT 0 NOT NULL, type text NOT NULL, notes text DEFAULT ''::text NOT NULL, menu_item_id text, menu_item_name text, quantity numeric, estimated_cost numeric, created_at timestamp with time zone DEFAULT now() NOT NULL, station_id text);
CREATE TABLE public.map_decorations (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, type text NOT NULL, x double precision DEFAULT 0 NOT NULL, y double precision DEFAULT 0 NOT NULL, w double precision DEFAULT 48 NOT NULL, h double precision DEFAULT 48 NOT NULL, floor text, rotation integer DEFAULT 0 NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);
CREATE TABLE public.menu_items (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, name text NOT NULL, description text DEFAULT ''::text, category text DEFAULT ''::text, price numeric(10,2) NOT NULL, prep_time integer DEFAULT 10, stock integer, max_stock integer, status text DEFAULT 'active'::text, icon text DEFAULT '🍽️'::text, image_url text DEFAULT ''::text, thumbnail_url text DEFAULT ''::text, tags text[] DEFAULT '{}'::text[], modifiers jsonb DEFAULT '[]'::jsonb, sort_order integer DEFAULT 0, sales_count integer DEFAULT 0, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), allergens text[], dietary_tags text[], calories integer, cost_per_serving numeric, recipe jsonb);
CREATE TABLE public.orders (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, order_number integer NOT NULL, table_id text, table_name text DEFAULT ''::text, items jsonb DEFAULT '[]'::jsonb NOT NULL, status text DEFAULT 'paid'::text, subtotal numeric(10,2) DEFAULT 0, tax_rate numeric(5,2) DEFAULT 0, tax_amount numeric(10,2) DEFAULT 0, total numeric(10,2) DEFAULT 0, payment_method text DEFAULT 'cash'::text, notes text DEFAULT ''::text, estimated_prep_time integer DEFAULT 15, prep_time_adjustment integer DEFAULT 0, created_at timestamp with time zone DEFAULT now(), paid_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), scheduled_for text);
CREATE TABLE public.receipts (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, order_id uuid, order_number integer, table_id text, table_name text DEFAULT ''::text, restaurant_name text DEFAULT ''::text, items jsonb DEFAULT '[]'::jsonb NOT NULL, subtotal numeric(10,2) DEFAULT 0, tax_rate numeric(5,2) DEFAULT 0, tax_amount numeric(10,2) DEFAULT 0, total numeric(10,2) DEFAULT 0, payment_method text DEFAULT 'cash'::text, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.shifts (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, date text NOT NULL, start_time text NOT NULL, end_time text NOT NULL, role text DEFAULT ''::text, employee_ids text[] DEFAULT '{}'::text[], min_staff integer DEFAULT 1, notes text DEFAULT ''::text, created_at timestamp with time zone DEFAULT now(), name text NOT NULL, color text DEFAULT '#6366f1'::text NOT NULL, station_id text, assignments jsonb DEFAULT '[]'::jsonb NOT NULL);
CREATE TABLE public.stock_reservations (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, session_id text NOT NULL, items jsonb DEFAULT '[]'::jsonb NOT NULL, expires_at timestamp with time zone NOT NULL, created_at timestamp with time zone DEFAULT now());
CREATE TABLE public.tables (id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL, user_id uuid NOT NULL, number integer NOT NULL, name text NOT NULL, capacity integer DEFAULT 4, status text DEFAULT 'available'::text, created_at timestamp with time zone DEFAULT now(), zone text, shape text DEFAULT 'square'::text NOT NULL, x double precision, y double precision, floor text, rotation integer DEFAULT 0 NOT NULL, size_scale double precision DEFAULT 1.0 NOT NULL);

ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_pkey PRIMARY KEY (id);
ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);
ALTER TABLE public.employees ADD CONSTRAINT employees_pkey PRIMARY KEY (id);
ALTER TABLE public.event_packages ADD CONSTRAINT event_packages_pkey PRIMARY KEY (id);
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_pkey PRIMARY KEY (id);
ALTER TABLE public.kitchen_events ADD CONSTRAINT kitchen_events_pkey PRIMARY KEY (id);
ALTER TABLE public.map_decorations ADD CONSTRAINT map_decorations_pkey PRIMARY KEY (id);
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_pkey PRIMARY KEY (id);
ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
ALTER TABLE public.receipts ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);
ALTER TABLE public.shifts ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);
ALTER TABLE public.stock_reservations ADD CONSTRAINT stock_reservations_pkey PRIMARY KEY (id);
ALTER TABLE public.tables ADD CONSTRAINT tables_pkey PRIMARY KEY (id);
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_restaurant_token_key UNIQUE (restaurant_token);
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_user_id_key UNIQUE (user_id);
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_tax_display_check CHECK ((tax_display = ANY (ARRAY['inclusive'::text, 'exclusive'::text, 'hidden'::text])));
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_zero_stock_behavior_check CHECK ((zero_stock_behavior = ANY (ARRAY['hide'::text, 'disable'::text])));
ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_created_by_check CHECK ((created_by = ANY (ARRAY['customer'::text, 'manager'::text, 'staff'::text])));
ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'cancelled'::text, 'completed'::text])));
ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_type_check CHECK ((type = ANY (ARRAY['reservation'::text, 'private_event'::text, 'closure'::text, 'takeaway'::text, 'delivery'::text])));
ALTER TABLE public.kitchen_events ADD CONSTRAINT kitchen_events_type_check CHECK ((type = ANY (ARRAY['waste'::text, 'remake'::text, 'delay'::text, 'note'::text])));
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'disabled'::text])));
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK ((status = ANY (ARRAY['paid'::text, 'preparing'::text, 'ready'::text, 'served'::text, 'completed'::text, 'cancelled'::text, 'refunded'::text])));
ALTER TABLE public.tables ADD CONSTRAINT tables_status_check CHECK ((status = ANY (ARRAY['available'::text, 'occupied'::text, 'reserved'::text])));
ALTER TABLE public.business_settings ADD CONSTRAINT business_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.calendar_events ADD CONSTRAINT calendar_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.employees ADD CONSTRAINT employees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.event_packages ADD CONSTRAINT event_packages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.ingredients ADD CONSTRAINT ingredients_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.kitchen_events ADD CONSTRAINT kitchen_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.map_decorations ADD CONSTRAINT map_decorations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.receipts ADD CONSTRAINT receipts_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE public.receipts ADD CONSTRAINT receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.shifts ADD CONSTRAINT shifts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.stock_reservations ADD CONSTRAINT stock_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.tables ADD CONSTRAINT tables_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX calendar_events_user_date ON public.calendar_events USING btree (user_id, date);
CREATE INDEX idx_menu_items_user_status ON public.menu_items USING btree (user_id, status);
CREATE INDEX idx_orders_user_created ON public.orders USING btree (user_id, created_at DESC);
CREATE INDEX idx_orders_user_status_created ON public.orders USING btree (user_id, status, created_at DESC);
CREATE INDEX idx_tables_user_number ON public.tables USING btree (user_id, number);
CREATE INDEX shifts_date_user ON public.shifts USING btree (user_id, date DESC);
CREATE INDEX shifts_user_date ON public.shifts USING btree (user_id, date);
CREATE INDEX stock_reservations_expires_at ON public.stock_reservations USING btree (expires_at);

ALTER TABLE public.business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kitchen_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_decorations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY owner_all_business_settings ON public.business_settings AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY owner_all_calendar_events ON public.calendar_events AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY owner_all_employees ON public.employees AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY owner_all_event_packages ON public.event_packages AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY ingredients_owner ON public.ingredients AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY kitchen_events_owner ON public.kitchen_events AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users manage own decorations" ON public.map_decorations AS PERMISSIVE FOR ALL TO public USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY owner_all_menu_items ON public.menu_items AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY anon_select_orders_realtime ON public.orders AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY owner_all_orders ON public.orders AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY owner_all_receipts ON public.receipts AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY owner_all_shifts ON public.shifts AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY owner_all_stock_reservations ON public.stock_reservations AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY anon_select_tables_realtime ON public.tables AS PERMISSIVE FOR SELECT TO anon USING (true);
CREATE POLICY owner_all_tables ON public.tables AS PERMISSIVE FOR ALL TO public USING ((auth.uid() = user_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kitchen_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tables;

-- Production functions (exact identity; stub bodies). ACL in production:
-- {=X, postgres=X, anon=X, authenticated=X, service_role=X} for all 13.
CREATE FUNCTION public.atomic_checkout(p_restaurant_token text, p_session_id text, p_table_id text, p_payment_method text, p_cart jsonb, p_notes text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.atomic_checkout(p_restaurant_token text, p_session_id text, p_table_id text, p_payment_method text, p_cart jsonb, p_notes text, p_scheduled_for text DEFAULT ''::text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.get_booking_data(p_restaurant_token text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.get_customer_menu(p_restaurant_token text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.get_order_status(p_restaurant_token text, p_order_number integer)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.get_receipt_by_id(p_receipt_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.get_roster_data(p_restaurant_token text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.station_adjust_prep_time(p_restaurant_token text, p_order_id uuid, p_delta_minutes integer)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.station_advance_order(p_restaurant_token text, p_order_id uuid, p_new_status text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.station_get_orders(p_restaurant_token text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.station_log_kitchen_event(p_restaurant_token text, p_id uuid, p_order_id uuid, p_order_number integer, p_type text, p_notes text, p_menu_item_id uuid DEFAULT NULL::uuid, p_menu_item_name text DEFAULT NULL::text, p_quantity integer DEFAULT NULL::integer)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.station_log_kitchen_event(p_restaurant_token text, p_id uuid, p_order_id uuid, p_order_number integer, p_type text, p_notes text, p_menu_item_id uuid DEFAULT NULL::uuid, p_menu_item_name text DEFAULT NULL::text, p_quantity integer DEFAULT NULL::integer, p_station_id text DEFAULT NULL::text)
  RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
CREATE FUNCTION public.submit_booking(p_restaurant_token text, p_date text, p_time_slot text, p_end_time text, p_type text, p_status text, p_customer_name text, p_customer_phone text, p_customer_email text, p_guest_count integer, p_package_id text, p_package_name text, p_notes text)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'production stub'; END $$;
