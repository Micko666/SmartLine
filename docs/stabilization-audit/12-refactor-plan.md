# 12 — Refactor & stabilization plan

Principi:
- Nijedan korak se ne radi bez **git-a** (repo trenutno nije git) i bez testa koji dokazuje sigurnost promjene.
- DB promjene idu **isključivo** kroz verzionisane migracije koje se prvo pokreću na lokalnom Supabase-u.
- Svaki task je označen kao **BP** (behavior-preserving) ili **BC** (behavior-changing).
- Reference na nalaze: BUG-xx / SEC-xx / ST-xx / BK-xx / R-x / I-xx iz ostalih izvještaja.

---

## Phase 0 — Critical correctness / security

| ID | Cilj | Fajlovi | Zavisi od | Rizik | Test koji dokazuje sigurnost | BP/BC |
|---|---|---|---|---|---|---|
| P0-01 | `git init` + baseline commit trenutnog stanja; `.gitignore` provjeren (`.env` isključen) | root | — | Nizak | `git status` čist; build/test isti kao u 02 | BP |
| P0-02 | Dodati `typecheck` skriptu (`tsc -p tsconfig.app.json --noEmit`) | `package.json` | P0-01 | Nizak | Skripta vraća tačno 11 grešaka iz 02 §2.3 (baseline) | BP |
| P0-03 | Popraviti `noSlotsToday` → `noSlots` | `src/pages/customer/OrderPortal.tsx:209` | P0-01 | Nizak | Novi component test: render `ScheduleStep` za danas bez exception-a; klik Takeaway → vidljiv select slotova | BC (popravka crash-a) |
| P0-04 | Local hydration: `_rehydrateLocal` zamijeniti pozivom `loadWorkspaceStateLocal` (jedna implementacija) + postaviti top-level `stations` | `AuthProvider.tsx:96-169`, `store/index.ts:109-146` (export) | P0-01 | Srednji | Test: seed workspace sa svih 17 slice-ova → simuliran refresh (AuthProvider mount) → akcija → localStorage i dalje ima sve slice-ove (reprodukcija 02 §3.2) | BC (prestaje gubitak podataka) |
| P0-05 | Supabase hydration: postaviti `stations: workspace.settings.stations ?? []` u `AuthProvider` | `AuthProvider.tsx:54` | P0-01 | Nizak | Unit sa mock `loadWorkspaceFromSupabase`: poslije init-a `stations.length === settings.stations.length`; `addStation` ne briše postojeće | BC |
| P0-06 | **Schema baseline**: prenijeti remote šemu (tabele `ingredients`, `kitchen_events`, `map_decorations`; sve `station_*` funkcije; `get_order_status`; indekse; `calendar_events` u publikaciji; stvarne tipove kolona) u verzionisanu migraciju. Popraviti/zamijeniti neizvršivu 003. Cilj: `supabase db reset` lokalno = remote. | `supabase/migrations/` (+ novi baseline fajl), dokumentovati strategiju (squash u `000_baseline.sql` ili `015_capture_drift.sql`) | P0-01 | Srednji (ne smije se primijeniti destruktivno na remote) | Diff `pg_dump --schema-only` lokalno vs remote = 0 (osim sistemskih objekata) | BP |
| P0-07 | DB test harness: lokalni Supabase + runner (pgTAP ili Vitest sa `pg` klijentom) | `supabase/tests/` ili `src/tests/db/`, `package.json` | P0-06 | Nizak | Smoke test prolazi u CI-ju/lokalno | BP |
| P0-08 | Ukloniti `anon_select_orders_realtime` i `anon_select_tables_realtime` | nova migracija | P0-07 | **Srednji**: station realtime pada na 30 s polling (ST-11) — prihvatljivo privremeno | RLS test: anon `select` iz `orders`/`tables` = 0 redova; station `station_get_orders` i dalje radi | BC |
| P0-09 | Hardening `atomic_checkout`: (a) `quantity` int > 0 i ≤ razumnog max; (b) modifier/opcija se traže u `menu_items.modifiers`, cijena i ime **iz DB-a**, provjera `required`/`maxSelections`; (c) all-or-nothing — prvo validacija svih stavki, pa oduzimanje, ili `RAISE EXCEPTION` za rollback; (d) `takeaway_enabled`/`delivery_enabled`; (e) `payment_method` ∈ enum; (f) `scheduled_for` format + budućnost; (g) `table_id` UUID mora pripadati tenantu ili biti keyword; (h) `DROP` 6-arg overload | nova migracija; `store/index.ts:928-950` (slati samo `{modifierId, optionId}`) | P0-07 | **Visok** (glavni prihodni tok) | DB testovi: qty -1/0 odbijeno i stock netaknut; lažni modifier odbijen; parcijalna nedostupnost ne mijenja stock; disabled kanal odbijen; 2 paralelne sesije za posljednji komad → 1 uspjeh; happy path total identičan staroj verziji za validne ulaze (golden test) | BC |
| P0-10 | `get_customer_menu`: ukloniti `stations`, `cost_per_serving`, `recipe`, `sales_count`, `userId`(?), koordinate stolova (ako Menu ne treba); dodati `get_station_public_config(token, station_id)` bez PIN-a | migracija; `StationGate.tsx`, `queries/public.ts`, `mappers.ts` | P0-07 | Srednji (StationGate zavisi od stations u odgovoru) | DB test: odgovor ne sadrži ključ `pin` ni `cost_per_serving`; component test StationGate učitava config preko novog RPC-a | BC |
| P0-11 | Station autentikacija na serveru (07 §4): `pin_hash` (pgcrypto), `station_login(station_id, pin)` sa rate-limit brojačem → session token; svi `station_*` zahtijevaju validnu sesiju, čitaju permissions iz DB-a, koriste SQL state machine; `cancelled` vraća stock i oslobađa sto; `updated_at` se ažurira; clamp prep time | migracije; `useStationOrders.ts`, `StationGate.tsx`, `stations.ts`, admin `Stations.tsx` (postavljanje PIN-a ide preko RPC-a) | P0-08, P0-10 | **Visok** | DB testovi: bez sesije → greška; kitchen → `cancelled` odbijen; service → dozvoljen + stock vraćen; nevalidna tranzicija odbijena; 10 pogrešnih PIN-ova → lockout | BC |
| P0-12 | `submit_booking`: status izvodi server (`requireApproval`), type ∈ {reservation, private_event}, validacija datuma, radnog dana, izuzetaka, `maxEventsPerDay` (uz lock), paketa (tenant, active), guests (paket/global max), dužine polja; `search_path` | migracija; `BookingPage.tsx` (više ne šalje status) | P0-07 | Srednji | DB testovi: `p_status='approved'` + requireApproval → `pending`; `closure` odbijen; 11. booking kad je max 10 → odbijen | BC |
| P0-13 | `get_roster_data`: eksplicitna lista kolona (bez phone/email/user_id), smjene samo u prozoru (npr. −7/+28 dana); `SET search_path` na svim SECURITY DEFINER funkcijama; `REVOKE TRUNCATE, REFERENCES, TRIGGER` sa anon/authenticated | migracija | P0-07 | Nizak | DB test: odgovor nema `phone`/`email`; advisor `function_search_path_mutable` = 0 | BC (manje podataka) |

## Phase 1 — Establish invariants and tests

| ID | Cilj | Fajlovi | Zavisi od | Rizik | Dokaz | BP/BC |
|---|---|---|---|---|---|---|
| P1-01 | Popraviti preostale TS greške (importi u FloorMapCanvas, hydration default, test fixture-i, `title` na ikoni) → `typecheck` zelen; dodati ga kao gate prije `build` | `FloorMapCanvas.tsx`, `hydration.ts`, `Orders.tsx`, `store.test.ts` | P0-02, P0-03 | Nizak | `npm run typecheck` exit 0 | BP |
| P1-02 | Uključiti `strictNullChecks` (pa `strict`) inkrementalno | `tsconfig.app.json` | P1-01 | Srednji (mnogo grešaka) | typecheck zelen po koraku | BP |
| P1-03 | Characterization testovi za postojeći store (Supabase grana sa mock klijentom): checkout mapping RPC odgovora, rollback-ovi, bridge pozivi | `src/tests/store.supabase.test.ts` | P1-01 | Nizak | Novi testovi prolaze na trenutnom kodu | BP |
| P1-04 | Component testovi kritičnih tokova: OrderPortal (open/closed/paused/kanali), Menu (dine-in QR, takeaway sa params, pause na dine-in), Receipt (Order More URL), BookingPage (status badge, lookup) | `src/tests/components/*` | P0-03 | Nizak | Testovi opisuju trenutno ponašanje (i bagove kao `it.fails`/TODO) | BP |
| P1-05 | DB invariant testovi za sve iz 04 (I-01…I-37 gdje je server relevantan), RLS cross-tenant suite (2 tenanta + anon) | `supabase/tests/*` | P0-07…P0-13 | Nizak | Svi prolaze | BP |
| P1-06 | Popraviti Playwright (ukloniti Lovable paket, standardni config) + 3 E2E smoke-a: dine-in QR, takeaway, admin advance order | `playwright.config.ts`, `e2e/*` | P0-03, P0-09 | Nizak | E2E prolaze lokalno na local Supabase-u | BP |
| P1-07 | Odlučiti o `served` statusu (dodati u TS + machine ili ukloniti iz CHECK-a) i dodati **server-side trigger** za validne tranzicije na `orders.status` (važi i za owner UPDATE) | migracija, `types.ts`, `orderMachine.ts` | P1-05 | Srednji | DB test: owner UPDATE `completed → paid` odbijen | BC |

## Phase 2 — Separate domain / services / state

| ID | Cilj | Fajlovi | Zavisi od | Rizik | Dokaz | BP/BC |
|---|---|---|---|---|---|---|
| P2-01 | `domain/ordering/pricing.ts` (line total, modifiers, tax, prep estimate) — čiste funkcije; koriste ih Menu i `_localCheckout` | novo + `Menu.tsx`, `store/index.ts` | P1-03, P1-04 | Nizak | Unit testovi + postojeći store testovi nepromijenjeni | BP |
| P2-02 | `domain/time` — "today"/datum/slot u **timezone-u restorana** (`settings.timezone`), jedna implementacija za OrderPortal, Menu, Receipt, Booking, Calendar, Orders, DashboardLayout, Analytics | novo + 8 fajlova | P1-04 | Srednji | Unit tabela slučajeva (UTC granica, DST, overnight) | **BC** (popravlja UTC bagove) |
| P2-03 | `domain/ordering/scheduling.ts` — open/closed + slotovi (+overnight); `SchedulingStep` jedna komponenta dijeljena između OrderPortal i Menu | `OrderPortal.tsx`, `Menu.tsx` | P2-02 | Srednji | Unit + component testovi iz P1-04 | BC (Menu fallback počinje poštovati radno vrijeme) |
| P2-04 | `domain/booking/availability.ts` + jedan default `CalendarSettings` | `BookingPage.tsx`, `store/index.ts`, `hydration.ts` | P2-02 | Nizak | Unit | BP |
| P2-05 | Persistence adapteri `localAdapter` / `supabaseAdapter` sa istim interfejsom; store akcije zovu servis umjesto `if (isSupabaseEnabled())` | `src/services/*`, `store/index.ts`, `bridge.ts` | P1-03 | **Visok** | Parity suite: isti scenariji nad oba adaptera daju isto stanje | BP (cilj) |
| P2-06 | Ujednačiti semantiku: cancel (stock + sto, server RPC `cancel_order`), remake (`→ preparing`), table status sa stanice (RPC), prep clamp | `useStationOrders.ts`, store, migracija | P0-11, P2-05 | Srednji | Parity testovi | BC (local remake mijenja smjer) |
| P2-07 | Store slice-ovi (03 §4) + jedna `hydrate(adapter)` funkcija za login i refresh; `logout` resetuje sve slice-ove | `src/store/slices/*` | P2-05 | Srednji | Svi store testovi + hydration test iz P0-04 | BP |
| P2-08 | Zabraniti `useStore.setState` van store-a (lint pravilo ili code review); realtime hook-ovi zovu store akcije `applyRemoteOrder`, … | realtime hooks, Menu, StationGate | P2-07 | Nizak | grep = 0; testovi | BP |

## Phase 3 — Supabase consistency

| ID | Cilj | Fajlovi | Zavisi od | Rizik | Dokaz | BP/BC |
|---|---|---|---|---|---|---|
| P3-01 | Strukturisana polja kupca na `orders` (`customer_name`, `customer_phone`, `delivery_address`, `order_channel`); `notes` samo za napomene; adresa van URL-a (state/sessionStorage) | migracija, `atomic_checkout`, Menu, OrderPortal, Receipt, Orders UI | P0-09, P2-01 | Srednji | DB + component testovi; admin prikaz | BC |
| P3-02 | Server-side radno vrijeme + scheduled validacija u `atomic_checkout` (timezone restorana); dine-in QR gating/pause ekran u Menu | migracija, Menu | P2-02, P2-03 | Srednji | DB testovi van radnog vremena | BC |
| P3-03 | Constraint-i: `UNIQUE(user_id, order_number)`, CHECK `stock >= 0`, `price >= 0`, `quantity`, `guest_count > 0`, `min_guests <= max_guests`, formati datuma (ili prelazak na `date`/`time`/`timestamptz` tipove) | migracije (sa backfill provjerom) | P1-05 | Srednji (postojeći podaci mogu kršiti) | Pre-check upit = 0 prekršaja; DB testovi | BC |
| P3-04 | Konkurentnost admin write-ova: `adjust_stock(id, delta)` RPC (relativno), `advance_order(id, expected_status)`, settings **PATCH** (samo promijenjena polja), `stations` van `business_settings` | migracije, bridge, store | P2-05, P0-11 | Srednji | Testovi R1–R3 iz 03 | BC |
| P3-05 | Realtime: stanice preko autentikovanog kanala (JWT claim ili Broadcast), kupčev meni preko Broadcast-a ili polling-a (useMenuSubscription danas ne radi), admin sluša `tables`; ispraviti `onVisible` merge (R4) | realtime hooks, migracije | P0-08, P0-11 | Srednji | Unit za merge; manual/E2E za realtime | BC |
| P3-06 | Kupčeve stock rezervacije: ili server-side RPC `reserve_stock(token, session, cart)` za anon, ili ukloniti koncept i osloniti se na `FOR UPDATE` + jasnu poruku | migracija ili store/Menu | P0-09 | Nizak | DB/unit | BC |
| P3-07 | Idempotency: `client_order_id` na `atomic_checkout` (UNIQUE) + guard u Menu i BookingPage | migracija, Menu, BookingPage | P0-09, P0-12 | Nizak | Dupli poziv → 1 red | BC |
| P3-08 | Limitirati hidrataciju (orders/receipts/kitchen_events: prozor + paginacija); prestati učitavati `receipts` ako se ne koriste | hydration, queries | P2-07 | Nizak | Test broja redova | BC |
| P3-09 | Enum tipovi ili CHECK za `payment_method`, `kitchen_events.order_id` → uuid FK, `package_id` → uuid FK | migracije | P3-03 | Srednji | DB testovi | BC |
| P3-10 | Supabase Auth: leaked password protection; provjeriti email confirmation tok u `signup` (sada UNKNOWN) | Supabase dashboard, `store.signup` | — | Nizak | Manual + test | BC |
| P3-11 | Demo nalog u Supabase deploymentu: ili zaseban seed tenant u Supabase-u, ili sakriti demo kad je Supabase uključen | `Login.tsx`, `store.login` | P2-05 | Nizak | Test: demo + Supabase ne zove bridge | BC |

## Phase 4 — UI / component cleanup

| ID | Cilj | Fajlovi | Zavisi od | Rizik | Dokaz | BP/BC |
|---|---|---|---|---|---|---|
| P4-01 | Podjela `Menu.tsx` (11 §10) | `pages/customer/menu/*` | P2-01, P2-03 | Srednji | Component/E2E iz P1 | BP |
| P4-02 | Podjela `Calendar.tsx`, `Tables.tsx`, `MenuManager.tsx`, `Orders.tsx`, `BookingPage.tsx`; spojiti `Tables` renderer sa `FloorMapCanvas` | admin/* | P1-04 | Srednji | Snapshot/component testovi | BP |
| P4-03 | Ukloniti dead code (11 §1): App.css, NavLink, use-mobile, example.test, React Query provider (ili ga početi koristiti za public fetch), nekorišćene store akcije, `bun.lock*` | razni | P1-01 | Nizak | build + test | BP |
| P4-04 | Ujednačiti copy/labele (`Pay on Pickup`, `rejected` badge), ukloniti dine-in petlju iz ModeSelectorScreen (ili dodati table picker u OrderPortal — **produktna odluka**) | Menu, Receipt, BookingPage | P1-04 | Nizak | Component testovi | BC |
| P4-05 | Error Boundary na nivou ruta (da crash kao `noSlotsToday` ne daje prazan ekran) | `App.tsx` | — | Nizak | Test: bačen error → fallback UI | BC |
| P4-06 | Ažurirati `CLAUDE.md`, `PROJECT_NOTES.md`, `README.md` prema 11 §3 | docs | sve prethodno | Nizak | Review | BP |

## Phase 5 — Ready for feature development

| ID | Cilj | Dokaz |
|---|---|---|
| P5-01 | CI pipeline: install (npm ci) → lint → typecheck → unit → DB tests (local Supabase) → build → E2E smoke | Zelen pipeline na PR-u |
| P5-02 | Migraciona disciplina: zabraniti SQL editor promjene na remote-u; drift check (`supabase db diff`) u CI-ju | Drift = 0 |
| P5-03 | Security gate: Supabase advisors bez ERROR/WARN za security (ili dokumentovani izuzeci) | Advisor report |
| P5-04 | Definition of Done za nove feature-e: domain funkcija + server enforcement + test na oba sloja + parity (ako local mode ostaje) | Checklist u CONTRIBUTING |
| P5-05 | Odluka o budućnosti local moda (zadržati kao demo sa jasnom oznakom ili ukloniti) — smanjuje dupli trošak svakog feature-a | ADR dokument |
| P5-06 | Tek tada: TODO #2 delivery mapa, stvarni payment provider, i18n | — |

---

## TOP 20 STABILIZATION TASKS (dependency redoslijed)

Svaki task zavisi samo od taskova iznad njega.

| # | Task | Ref | Zavisi od | BP/BC |
|---|---|---|---|---|
| 1 | `git init` + baseline commit | P0-01 | — | BP |
| 2 | `typecheck` skripta (baseline 11 grešaka) | P0-02 | 1 | BP |
| 3 | Fix `noSlotsToday` + component test za ScheduleStep | P0-03 | 1 | BC |
| 4 | Fix local hydration (gubitak podataka) + test | P0-04 | 1 | BC |
| 5 | Fix Supabase hydration `stations` + test | P0-05 | 1 | BC |
| 6 | Schema baseline: remote šema u verzionisanu migraciju, `db reset` = remote | P0-06 | 1 | BP |
| 7 | DB test harness (lokalni Supabase) | P0-07 | 6 | BP |
| 8 | Ukloniti anon `orders`/`tables` policies + RLS cross-tenant testovi | P0-08 | 7 | BC |
| 9 | Hardening `atomic_checkout` (qty, modifieri iz DB-a, all-or-nothing, kanal, payment enum, scheduled format, drop 6-arg) + DB testovi | P0-09 | 7 | BC |
| 10 | Ukloniti PIN i interne podatke iz `get_customer_menu`; `get_station_public_config` | P0-10 | 7 | BC |
| 11 | Station server auth (pin_hash, login/session, permissions, state machine, cancel vraća stock) | P0-11 | 8, 10 | BC |
| 12 | `submit_booking` hardening (status/type server-side, validacije) | P0-12 | 7 | BC |
| 13 | `get_roster_data` minimalna polja + `search_path` na svim DEFINER funkcijama + revoke viška grant-ova | P0-13 | 7 | BC |
| 14 | Preostale TS greške → typecheck zelen kao gate | P1-01 | 2, 3 | BP |
| 15 | Characterization testovi (store Supabase grana, ključne komponente) | P1-03, P1-04 | 14 | BP |
| 16 | Server-side order state machine trigger (+ odluka o `served`) | P1-07 | 7, 11 | BC |
| 17 | Domain moduli: pricing + time/timezone + scheduling (popravlja UTC bagove) | P2-01…P2-03 | 15 | BC |
| 18 | Persistence adapteri + parity suite; ujednačen cancel/remake/table status | P2-05, P2-06 | 11, 15 | BP/BC |
| 19 | Store slice-ovi + jedinstvena hidratacija + konkurentni write-ovi (relativni stock, expected status, settings patch) | P2-07, P3-04 | 18 | BC |
| 20 | Strukturisana polja kupca (PII iz notes/URL) + server radno vrijeme; zatim UI podjela (Menu/Calendar/Tables) i dead code | P3-01, P3-02, P4-01…P4-03 | 9, 17, 19 | BC/BP |

Napomena o redoslijedu: 3–5 su jeftini i hitni, ali dolaze poslije 1, jer bez git-a nema bezbjednog revert-a. 8–13 su hitni sigurnosni zadaci, ali zavise od 6–7: bez vjerne lokalne kopije šeme svaka nova migracija nad remote-om je slijepa (drift u 05 §1).
