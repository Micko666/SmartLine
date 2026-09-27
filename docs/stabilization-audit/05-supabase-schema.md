# 05 — Supabase schema audit

Izvori:
1. **Migrations folder**: `supabase/migrations/001…014`, pročitani redom. Konačno stanje je izračunato primjenom svih `CREATE`/`ALTER`/`DROP`/`CREATE OR REPLACE`.
2. **Remote**: projekat `SmartLine` (`bcwlizkhceidumyaygda`, eu-central-1, Postgres 17). Korišćeni su samo read-only katalog upiti (`pg_proc`, `pg_policies`, `information_schema`, `pg_indexes`, `pg_constraint`), `list_migrations` i security advisors. Ništa nije mijenjano.

Legenda: **SCHEMA DRIFT** = postoji remote, a nema ga u migrations folderu (ili obrnuto).

---

## 1. Najvažniji zaključak: migrations folder NIJE izvor istine — CONFIRMED

Remote `supabase_migrations` istorija ima 29 unosa. Lokalni folder ima 14 fajlova.

| Remote verzija | Remote ime | Lokalni fajl |
|---|---|---|
| 20260413105017 | add_ingredients_kitchen_events_menu_extended_fields | **NEMA** |
| 20260413130842 | add_stations_to_business_settings | NEMA (005 radi `ADD COLUMN IF NOT EXISTS stations`) |
| 20260413131237 | add_station_get_orders_rpc | **NEMA** |
| 20260413133411 | fix_station_get_orders_order_by | **NEMA** |
| 20260413134826 | add_zone_and_shape_to_tables | NEMA (005 pokriva kolone) |
| 20260413140318 | add_xy_position_to_tables | NEMA (005 pokriva, ali **drugi tip**) |
| 20260413144614 | add_floor_to_tables | NEMA (005 pokriva) |
| 20260413152445 | add_rotation_to_tables | NEMA (005 pokriva) |
| 20260413154618 | add_size_scale_and_map_decorations | **NEMA** (`map_decorations` tabela) |
| 20260413170225 | add_station_kitchen_rpcs | **NEMA** |
| 20260413175442 | add_get_customer_menu_rpc | NEMA (zamijenjeno kasnijim) |
| 20260413183030 | add_get_order_status_rpc | **NEMA** (009 kaže "fix — referenced non-existent `settings` table") |
| 20260413235142 | get_customer_menu_full_tables | NEMA |
| 20260414082222 | add_orders_performance_indexes | **NEMA** |
| 20260416115754 | add_station_id_to_kitchen_events | **NEMA** |
| 20260416115859 | station_log_kitchen_event_add_station_id | **NEMA** |
| 20260416212025 | calendar_roster | 002 |
| 20260417070010 | shift_assignments | 003 (sadržaj vjerovatno drugačiji, vidi §5) |
| 20260417114210 … 20260509112524 | 004 … 014 | 004–014 (010 = `categories_column`, 011 = `uuid_generate_fix`, 012 = `ordering_modes`) |

Takođe: **`001_initial.sql` nije u remote istoriji.** Inicijalna šema je primijenjena van migration trackinga (SQL editor).

**Posljedica:** `supabase db reset` ili novi projekat iz ovog foldera **NE MOŽE** reprodukovati produkciju. Nedostaju tabele `ingredients`, `kitchen_events`, `map_decorations`, sve `station_*` funkcije, originalni `get_order_status`, indeksi i `calendar_events` u realtime publikaciji.

---

## 2. Efektivna šema — tabele

Kolone su prikazane kako ih vidi remote. Oznaka **[mig]** = definisano u migracijama; **[DRIFT]** = samo remote.

### business_settings [mig 001, +002, +005, +006, +010, +012, +013]
| Kolona | Tip | Default | Null |
|---|---|---|---|
| id | uuid PK | uuid_generate_v4() | NO |
| user_id | uuid FK→auth.users ON DELETE CASCADE, **UNIQUE** | — | NO |
| business_name | text | 'My Restaurant' | NO |
| business_type, currency, currency_symbol, language, timezone, opening_hours, service_mode, app_url, logo_url | text | razni | YES |
| tax_rate | numeric(5,2) | 10 | YES |
| tax_display | text CHECK in (inclusive, exclusive, hidden) | 'inclusive' | YES |
| low_stock_threshold | int | 5 | YES |
| zero_stock_behavior | text CHECK in (hide, disable) | 'disable' | YES |
| restaurant_token | text **UNIQUE** | — | NO |
| categories | **text[]** | '{}' | YES |
| next_order_number | int | 1001 | YES |
| calendar_settings | jsonb | '{}' | YES |
| stations | jsonb | '[]' | YES — **sadrži plaintext PIN-ove** |
| ordering_paused | bool | false | YES |
| ordering_paused_message | text | '' | YES |
| takeaway_enabled | bool | true | YES |
| delivery_enabled | bool | false | YES |
| business_hours | jsonb | NULL | YES |

Napomena: migracija 010 radi `ADD COLUMN IF NOT EXISTS categories JSONB`, ali kolona već postoji iz 001 kao `text[]` → **010 je no-op**. Komentari u `010` i `src/lib/supabase/queries/settings.ts` ("JSONB column") su netačni (CONFIRMED remote: `_text`).

### menu_items [mig 001, +005]
id uuid PK · user_id FK · name text NN · description · category · price numeric(10,2) NN · prep_time int 10 · stock int NULL(=∞) · max_stock int · status CHECK(active, archived, disabled) · icon · image_url · thumbnail_url · tags text[] · modifiers jsonb '[]' · sort_order · sales_count · created_at · updated_at · allergens text[] · dietary_tags text[] · calories int · cost_per_serving numeric · recipe jsonb.
- **Nema CHECK `stock >= 0`**, `price >= 0` ni `max_stock >= stock`.

### tables [mig 001, +005; tipovi DRIFT]
id · user_id · number int NN · name NN · capacity 4 · status CHECK(available, occupied, reserved) · created_at · zone · shape text NN 'square' · x · y · floor · rotation int NN 0 · size_scale NN 1.0
- **DRIFT tipova**: migracija 005 → `x numeric, y numeric, size_scale numeric`, `shape` nullable, `rotation` nullable; remote → `double precision` i NOT NULL. Remote vrijednosti su nastale iz nevezionisanih migracija (0413xxxx).
- Nema `UNIQUE(user_id, number)`.

### orders [mig 001, +013]
id · user_id · order_number int NN · table_id **text** · table_name · items jsonb NN · status CHECK(paid, preparing, ready, **served**, completed, cancelled, refunded) · subtotal · tax_rate · tax_amount · total · payment_method text (bez CHECK) · notes · estimated_prep_time · prep_time_adjustment · created_at · paid_at · updated_at · scheduled_for **text**
- `served` postoji u CHECK-u, ali ne i u TS `OrderStatus` ni u `orderMachine.ts`.
- **Nema `UNIQUE(user_id, order_number)`.**
- Nema CHECK `total >= 0`; `table_id` nema FK (namjerno — keyword vrijednosti).
- `scheduled_for` je slobodan tekst bez formata/CHECK-a.

### receipts [mig 001]
id · user_id · order_id FK→orders ON DELETE SET NULL · order_number · table_id · table_name · restaurant_name · items · subtotal · tax_rate · tax_amount · total · payment_method · created_at. **Nema scheduled_for.**

### stock_reservations [mig 001]
id · user_id · session_id text NN · items jsonb · expires_at timestamptz NN · created_at. Index `stock_reservations_expires_at`.

### calendar_events [mig 002, +004]
id · user_id · date **text** · time_slot **text** · end_time · type CHECK(reservation, private_event, closure, takeaway, delivery) · status CHECK(pending, approved, rejected, cancelled, completed) · customer_name/phone/email · guest_count int 1 · package_id **text** (bez FK) · package_name · notes · closure_reason · created_by CHECK(customer, manager, staff) · approved_by · approved_at · rejection_reason · created_at · updated_at. Index `(user_id, date)`.
- Datumi su `text`; nema CHECK formata; nema `guest_count > 0`.

### event_packages [mig 002]
id · user_id · name · emoji · description · min_guests 1 · max_guests 100 · fixed_price · price_per_person · duration numeric(4,1) · details · active · created_at. Bez CHECK `min <= max`.

### employees [mig 002]
id · user_id · name · role · **phone · email** (PII) · color · active · created_at.

### shifts [mig 002, +003]
id · user_id · date text · start_time · end_time · role · employee_ids **text[]** (legacy, i dalje postoji) · min_staff · notes · created_at · name NN · color NN · station_id · assignments jsonb NN. Indeksi `shifts_user_date (user_id, date)` i `shifts_date_user (user_id, date DESC)` — **duplikat**.

### ingredients — **SCHEMA DRIFT (samo remote)**
id uuid PK · user_id FK · name NN · unit NN 'g' · cost_per_unit numeric NN 0 · stock numeric · created_at · updated_at. RLS policy `ingredients_owner` (authenticated, ALL, `auth.uid()=user_id`).

### kitchen_events — **SCHEMA DRIFT (samo remote)**
id · user_id · order_id **text** NN · order_number int NN 0 · type CHECK(waste, remake, delay, note) · notes NN · menu_item_id **text** · menu_item_name · quantity numeric · estimated_cost numeric · created_at · station_id text. Policy `kitchen_events_owner`. U realtime publikaciji (014).

### map_decorations — **SCHEMA DRIFT (samo remote)**
id uuid `gen_random_uuid()` · user_id · type NN · x/y/w/h float8 · floor · rotation int · created_at. Policy `Users manage own decorations` (role public, ALL).

---

## 3. Indeksi

| Indeks | Izvor |
|---|---|
| PK na svim tabelama; `business_settings (user_id)` UNIQUE; `(restaurant_token)` UNIQUE | mig 001 |
| `stock_reservations_expires_at` | mig 001 |
| `calendar_events_user_date`, `shifts_user_date` | mig 002 |
| `shifts_date_user` | mig 003 |
| `idx_menu_items_user_status (user_id, status)` | **DRIFT** |
| `idx_orders_user_created (user_id, created_at DESC)` | **DRIFT** |
| `idx_orders_user_status_created (user_id, status, created_at DESC)` | **DRIFT** |
| `idx_tables_user_number (user_id, number)` | **DRIFT** |

Nedostaju indeksi na `receipts(user_id, created_at)`, `employees(user_id)`, `event_packages(user_id)`, `ingredients(user_id)`, `kitchen_events(user_id, created_at)`, `stock_reservations(user_id, session_id)`, `orders(user_id, order_number)` (koristi ga `get_order_status`).

---

## 4. RLS i policies (konačno stanje; remote se poklapa sa migracijama osim DRIFT tabela)

Sve tabele imaju `relrowsecurity = true` (CONFIRMED remote).

| Tabela | Policy | Role | Cmd | USING / WITH CHECK |
|---|---|---|---|---|
| business_settings | owner_all_business_settings | public | ALL | `auth.uid() = user_id` / — |
| menu_items | owner_all_menu_items | public | ALL | isto |
| tables | owner_all_tables | public | ALL | isto |
| **tables** | **anon_select_tables_realtime** | **anon** | SELECT | **`true`** (mig 014) |
| orders | owner_all_orders | public | ALL | isto |
| **orders** | **anon_select_orders_realtime** | **anon** | SELECT | **`true`** (mig 014) |
| receipts | owner_all_receipts | public | ALL | isto |
| stock_reservations | owner_all_stock_reservations | public | ALL | isto |
| calendar_events / event_packages / employees / shifts | owner_all_* | public | ALL | isto |
| ingredients | ingredients_owner | authenticated | ALL | isto / isto (DRIFT) |
| kitchen_events | kitchen_events_owner | authenticated | ALL | isto / isto (DRIFT) |
| map_decorations | Users manage own decorations | public | ALL | isto / isto (DRIFT) |

Dropovano u 009: `public_read_business_settings`, `public_read_calendar_events`, `public_read_receipt_by_id`, `public_read_active_menu_items`, `public_read_tables`, `public_read_shifts`, `public_read_active_event_packages`. Dva od njih (`public_read_business_settings`, `public_read_tables`) nisu kreirana ni u jednoj lokalnoj migraciji → i ovo je dokaz drift-a.

`owner_all_*` policies iz 001/002 nemaju `WITH CHECK`; Postgres tada koristi USING izraz i za INSERT/UPDATE, pa je to funkcionalno OK.

**Table GRANTs**: `anon` i `authenticated` imaju SVE privilegije (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) na svim public tabelama (Supabase default). Jedina zaštita je RLS. `TRUNCATE` ne prolazi kroz RLS, ali PostgREST ga ne izlaže — nizak rizik; ipak ga ukloniti.

### Storage (mig 008)
Bucket `menu-images`, `public = true`. Policies na `storage.objects`: read (anon, authenticated, `bucket_id='menu-images'`); insert/update/delete (authenticated, prvi folder = `auth.uid()`). Poklapa se sa remote. Napomena: public bucket znači da su svi objekti čitljivi bez policy-ja preko public URL-a (namjerno).

### Realtime publikacija `supabase_realtime`
| Tabela | Izvor |
|---|---|
| orders, menu_items | mig 001 |
| kitchen_events, tables | mig 014 |
| **calendar_events** | **DRIFT** (nijedna migracija je ne dodaje; `useRealtimeCoordinator` je sluša) |

### Replica identity
Sve tabele `DEFAULT` (PK). 014 eksplicitno postavlja za `tables`. Za UPDATE događaje `payload.old` sadrži samo PK — kod koristi samo `payload.new`, pa je OK.

---

## 5. Problemi sa samim migracijama

| # | Fajl | Problem | Status |
|---|---|---|---|
| M1 | `003_shift_assignments.sql:22` | `jsonb_array_length(COALESCE(employee_ids, '[]'::jsonb))`, a `employee_ids` je `text[]` (002 i remote). `COALESCE(text[], jsonb)` → greška "COALESCE types text[] and jsonb cannot be matched" pri parsiranju. Isto `jsonb_array_elements_text(employee_ids)`. | CONFIRMED statički; **fajl nije re-playable** na svježoj bazi. Remote je primijenio neku drugu verziju (UNKNOWN sadržaj). |
| M2 | `010_categories_column.sql` | No-op (kolona već postoji kao `text[]`) | CONFIRMED |
| M3 | `001_initial.sql` | Nije u remote istoriji | CONFIRMED |
| M4 | `012_ordering_modes.sql:26` | Sekcija "2. get_customer_menu" je prazna u ovom fajlu (samo header) — tijelo je na liniji 28+ | Kozmetika |
| M5 | `013` | `CREATE OR REPLACE atomic_checkout(... , p_scheduled_for text DEFAULT '')` — **drugi potpis** ⇒ ne zamjenjuje 6-arg verziju. Obje postoje i obje su `GRANT EXECUTE TO anon` | CONFIRMED remote (2 overload-a) |
| M6 | `011` | Komentar kaže da default-i kolona i dalje koriste `uuid_generate_v4()` iz `extensions` — tačno (remote default-i su `uuid_generate_v4()`), osim `map_decorations` (`gen_random_uuid()`) | CONFIRMED |
| M7 | 002, remote station_* | `get_booking_data`, `get_roster_data` i svih 5 `station_*` funkcija su SECURITY DEFINER **bez `SET search_path`** (advisor `function_search_path_mutable`, 7 nalaza) | CONFIRMED remote |

---

## 6. RPC inventory

Frontend pozivi `supabase.rpc(...)` (grep cijelog `src`):

| Function | Frontend caller | U migracijama? | Remote potpis(i) | anon exec | SECURITY DEFINER | search_path | Input validation | Tenant scope | Mutira |
|---|---|---|---|---|---|---|---|---|---|
| `atomic_checkout` | `src/store/index.ts:942` | 013 (7-arg); 012 (6-arg, i dalje živi) | **2 overload-a** | DA | DA | public | Slaba: provjerava restaurant, `ordering_paused`, status i stock artikla. **NE** provjerava qty>0, modifiere, cijene modifiera, payment_method, scheduled_for, kanal enabled, radno vrijeme | token → user_id | orders, receipts, menu_items.stock/sales_count, business_settings.next_order_number, tables.status, stock_reservations |
| `get_customer_menu` | `src/lib/supabase/queries/public.ts:26` | 013 | 1 | DA | DA | public | — | token | ne |
| `get_booking_data` | `public.ts:64` | 002 | 1 | DA | DA | **nije postavljen** | — | token | ne |
| `submit_booking` | `public.ts:98` | 011 | 1 | DA | DA | public | **Nema**: `p_status`, `p_type`, datum, vrijeme, guest_count, package — sve se prihvata | token | calendar_events INSERT |
| `get_roster_data` | `public.ts:131` | 002 | 1 | DA | DA | **nije postavljen** | — | token | ne |
| `get_order_status` | `src/pages/customer/OrderTracker.tsx:148` | 009 (CREATE OR REPLACE; original = DRIFT) | 1 | DA | DA | public | — | token + order_number | ne |
| `get_receipt_by_id` | `src/lib/supabase/queries/receipts.ts:22` | 009 | 1 | DA | DA | public | — | **nema tenant scope** (UUID = capability) | ne |
| `station_get_orders` | `src/lib/supabase/realtime/useStationOrders.ts:43` | **NE — SCHEMA DRIFT** | 1 | DA | DA | **nije postavljen** | — | token | ne |
| `station_advance_order` | `useStationOrders.ts:147` | **NE — SCHEMA DRIFT** | 1 | DA | DA | **nije postavljen** | **Nema** — `p_new_status` se upisuje direktno (samo DB CHECK) | token | orders.status |
| `station_adjust_prep_time` | `useStationOrders.ts:170` | **NE — SCHEMA DRIFT** | 1 | DA | DA | **nije postavljen** | **Nema** granica (store ima -60..180) | token | orders.prep_time_adjustment |
| `station_log_kitchen_event` | `useStationOrders.ts:197` | **NE — SCHEMA DRIFT** | **2 overload-a** (9 i 10 arg) | DA | DA | **nije postavljen** | **Nema**; `p_id` bira klijent; `p_order_id` se ne provjerava da pripada tenant-u | token | kitchen_events INSERT |

Supabase advisors (remote, 2026-09-27): 13× `anon_security_definer_function_executable`, 13× `authenticated_security_definer_function_executable`, 7× `function_search_path_mutable`, 1× `auth_leaked_password_protection` (disabled).

Napomena o default EXECUTE: Postgres po default-u daje `EXECUTE` roli `PUBLIC` za nove funkcije. Station funkcije nemaju eksplicitan GRANT u lokalnom kodu, ali su remote anon-izvršive (CONFIRMED `has_function_privilege`).

### Tijela DRIFT funkcija (remote, sažeto)
- `station_get_orders(p_restaurant_token)` → `SELECT * FROM orders WHERE user_id = v_user_id AND status NOT IN ('completed','refunded') ORDER BY created_at DESC` — vraća **sve kolone** (uključujući `notes` sa imenom/telefonom/adresom kupca) i **sve otkazane narudžbe ikada** (bez vremenskog limita).
- `station_advance_order(token, order_id, new_status)` → provjeri da narudžba pripada tenant-u → `UPDATE orders SET status = p_new_status`. **Ne ažurira `updated_at`**, ne radi state machine, ne vraća stock pri `cancelled`, ne oslobađa sto.
- `station_adjust_prep_time(token, order_id, delta)` → `prep_time_adjustment += delta`, bez clamp-a, bez `updated_at`.
- `station_log_kitchen_event(...)` → INSERT u `kitchen_events` sa klijentskim `p_id`; bez provjere `order_id`.

Body-level diff za ne-DRIFT funkcije nije rađen znak-po-znak. Provjereno je samo prisustvo ključnih izraza: `get_customer_menu` sadrži `stations` i `business_hours`; 7-arg `atomic_checkout` sadrži `scheduled_for` i `gen_random_uuid`. Za ostale funkcije potpuna podudarnost sa migracijama je **UNKNOWN**.

---

## 7. Stanje podataka relevantno za audit (remote, samo agregati)
- 2 reda u `business_settings` (2 tenanta). Stanice: 0 i 1; nijedna trenutno nema postavljen PIN. `business_hours` je NULL za oba → gating radnog vremena u Supabase modu je trenutno **isključen** (`checkOpenStatus` vraća open kad nema sati).
- Kao `anon` (`SET LOCAL ROLE anon` u transakciji sa ROLLBACK): **139 redova u `orders`** i **12 redova u `tables`** su čitljivi; `receipts` i `business_settings` = 0. Vidljiv je samo 1 tenant, jer samo jedan ima narudžbe. Policy je `USING (true)` bez tenant filtera, pa je cross-tenant čitanje strukturno garantovano.
