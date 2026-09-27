# SmartLine stabilization execution

> **Release verification (2026-09-27):** see [production-release-readiness.md](production-release-readiness.md) for the candidate SHA, clean runs, real-PostgreSQL concurrency, upgrade rehearsal, compatibility matrix, the current runbook and the final status. Sections below that conflict with it (runbook, blockers, test counts) are superseded by it.

Branch: `stabilization/astra` · Date: 2026-09-27 · Base: `72516dd` (baseline commit of the supplied workspace)

Status legend: **DONE**, **READY** (implemented and tested; needs a manual gate), **BLOCKED** (external dependency), **NOT DONE** (with reason), **DECISION** (product owner).

---

## Starting state

The audit in `docs/stabilization-audit/` (00–12) described the starting point. Re-verified before changing anything:

| Check | Starting result |
|---|---|
| Git | `stabilization/astra` with a baseline commit and **uncommitted work from an earlier session** (migrations 015–017, workspace/hydration refactor, scheduling domain, tests). That work was preserved, reviewed, completed and committed; nothing was discarded. |
| `npm run lint` | 0 errors (warnings only) |
| `npm test` | 91/91 at audit time; 111/113 at session start (2 hydration tests failing on the in-progress refactor) |
| `npx tsc --noEmit` | false green (root config has `files: []`) |
| `tsc -p tsconfig.app.json` | 11 errors at audit time; 4 at session start |
| `npm run build` | green (Vite does not type-check) |
| Playwright | broken (`lovable-agent-playwright-config` missing), 0 E2E tests |
| DB | 14 repo migrations vs 29 in production history; 16 production migrations untracked |
| Runtime | `/order/:token` → Takeaway/Delivery crashed with `ReferenceError: noSlotsToday` (reproduced in the audit) |

## Changes made

Grouped by phase. See **Commits** for the exact sequence.

### Phase A — safety rails
- `npm run typecheck` (`tsc -p tsconfig.app.json` + node config) replaces the false-green root `tsc`. **DONE**
- `OrderPortal` crash fixed; ordering scheduling moved to `src/domain/ordering/scheduling.ts`. Component test renders the schedule step for today without error. **DONE**
- One canonical local (de)serializer (`src/store/workspace.ts`: `loadWorkspaceStateLocal` / `workspaceSnapshot` / `normalizeWorkspace`), used by login, refresh (`AuthProvider` → `restoreLocalSession`) and tests. Regression test writes all 17 slices, simulates refresh, performs a normal write and asserts that no slice is lost. **DONE**
- Supabase hydration keeps `stations` (now loaded from `list_stations`); test covers "refresh then addStation keeps existing stations". **DONE**
- Logout and `SIGNED_OUT` use the same `resetWorkspace`; a test enumerates every tenant-scoped key of the store. **DONE**
- App-level `ErrorBoundary` with a recoverable fallback. **DONE**

### Phase B — reproducible backend
- `015_reconstruct_schema.sql` recreates production-only objects (`ingredients`, `kitchen_events`, `map_decorations`, performance indexes, `calendar_events` realtime publication) and aligns floor-map column types/nullability with production. On production these statements are no-ops.
- Historical replay repairs: `003` used `jsonb` functions on a `text[]` column (not replayable), and `014` added `kitchen_events` to the publication before any migration created the table. Both were fixed so the chain replays from an empty database. Production already contains their effects and does not re-run them (see **Database/migrations**).
- DB test harness: `npm run test:db` runs every migration on an in-process Postgres (PGlite, Postgres compiled to WASM) behind a Supabase shim (`supabase/tests/support/supabase-shim.sql`: `auth.uid()`, `anon`/`authenticated` roles, storage schema, realtime publication, platform default grants). No Docker needed.
- Production parity: `supabase/tests/fixtures/production-schema-2026-09-27.json` is a read-only snapshot of the production catalog. A test asserts that every production column (type and nullability), index and publication member exists after a fresh replay. **DONE**
- `supabase/config.toml` for the Supabase CLI local stack. `supabase db reset` itself: **BLOCKED** (no Docker or Supabase CLI on this machine). The same migrations replay in PGlite in CI.

### Phase C — security
| Item | Migration / code | Status |
|---|---|---|
| Close global anon `SELECT USING (true)` on `orders` / `tables` | 015 | DONE (tests: anon reads 0 rows from 13 tables; owner A never sees B) |
| Checkout does not trust the browser: integer quantity 1..100, ≤ 50 lines, modifiers resolved from `menu_items.modifiers` (ids, required, maxSelections), prices/tax/total computed server-side, payment method enum, channel enabled, business hours, scheduled time (format, ≥ now + 30 min, ≤ 90 days, DST-safe), dine-in table must belong to the tenant | 016 | DONE |
| All-or-nothing: pass 1 validates and prices everything; pass 2 mutates; any error rolls back the whole call | 016 | DONE (test: partial cart failure leaves stock and orders unchanged) |
| Idempotent checkout (`client_order_id`, unique per tenant) | 015/016 | DONE (test: same key twice → one order, one deduction) |
| Legacy 6/7-argument `atomic_checkout` overloads removed | 016 | DONE |
| Customer menu RPC minimized (no stations/PIN, cost, recipe, sales, owner id; tables reduced to id/number/name) | 019 | DONE (test on the JSON) |
| Station auth: `stations` table, bcrypt `pin_hash`, `station_login` → opaque 64-hex token (only SHA-256 stored), 12 h expiry, lockout after 5 wrong PINs for 15 min; every `station_*` RPC checks session + permissions + state machine; PIN change revokes sessions; legacy token-only RPCs dropped; plaintext PINs backfilled into hashes and scrubbed | 018, 022 | DONE |
| Booking: server decides status from `requireApproval`; customer types limited to `reservation`/`private_event`; date/time/working day/exceptions/closure/advance window/max-per-day (serialized by a settings-row lock)/package ownership, activity and guest range/field lengths validated; idempotent; confirmation code | 020 | DONE |
| Booking lookup: `lookup_booking_status(token, phone, code)`; `get_booking_data` no longer returns ids or any customer data | 019, 020 | DONE |
| Roster: explicit shape (no phone/email/user_id), shifts limited to −7..+28 days | 019 | DONE |
| SECURITY DEFINER hardening: EXECUTE revoked from PUBLIC/anon/authenticated on every public function, then an explicit allow-list; default privileges no longer grant EXECUTE to new functions; `search_path` pinned on every definer function; TRUNCATE/REFERENCES/TRIGGER revoked from API roles | 021 | DONE (tests assert the exact allow-list) |

A hole found while doing this: `transition_order_internal(p_user_id, …)` (added in 017) is SECURITY DEFINER and takes the tenant id as a parameter. Because Postgres grants EXECUTE to PUBLIC by default, anon could call it for any tenant. 021 closes this; a test asserts `permission denied`.

### Phase D — domain correctness
- Server-enforced order state machine: a trigger rejects invalid transitions for every writer (owner UPDATE included). The single exception, rework `ready → preparing`, is allowed only for a station actor tagged `:rework` (a station with `canReworkOrders`). `served` removed (existing rows mapped to `completed`; production has 0). **DONE**
- `cancel_order` / `transition_order_internal`: one transaction that validates the transition, restores stock exactly once (`stock_restored_at`), releases the table when no active orders remain, sets `updated_at` and records `last_actor`. Admin and station use the same function. **DONE**
- Concurrency-safe writes: `adjust_stock(item, delta)` (relative); absolute stock entry is a compare-and-swap on `updated_at`; `advance_order(id, expected, next)`; `patch_settings(changed fields)` with an allow-list; stations are no longer written through the settings row. **DONE**
- Timezone: `src/domain/time/restaurantTime.ts` (native `Intl`, no dependency) provides restaurant-local date/time, DST-aware wall-time resolution, overnight hours and formatting. Used by the portal, menu, receipt, booking, admin Orders/Dashboard/Analytics and the notification badge. Unit matrix: Europe/Podgorica, UTC boundary, DST forward/back, overnight, closed day, just before close, after midnight, next day. **DONE**
- One ordering slot source (`orderingSlots`). Menu's fallback scheduler can no longer offer slots the portal would reject, and a stale or edited URL time is re-validated before payment. **DONE**
- Calendar week grid and roster built dates with `toISOString()` from local midnight. East of UTC this shifted every date back one day; they now use `localDateKey`. **DONE**
- Structured PII: `orders.customer_name/customer_phone/delivery_address/order_channel`. `notes` is only the customer's note, and the delivery address travels in `sessionStorage`, never in a URL. Admin shows structured fields and still shows legacy notes. **DONE**
- Constraints: `UNIQUE(user_id, order_number)`, non-negative price/stock/max_stock, positive guests, package min ≤ max, payment method / payment state / channel enums; validated in 023 after a clean read-only preflight. **DONE** (text date/time columns: see Remaining blockers)

### Phase E — architecture
- `src/domain/*` holds pure rules with no React/store/IO: `ordering/cart.ts` (mirror of `atomic_checkout`), `ordering/orderOperations.ts` (mirror of `transition_order_internal`), `ordering/scheduling.ts`, `ordering/orderMerge.ts`, `booking/policy.ts` (mirror of `submit_booking`), `time/restaurantTime.ts`, `stations.ts` (station permission rule).
- `src/services/*` holds persistence/IO: `workspaceService` (owner RPCs), `stationService` (session-based station API), `bookingService` (one API for both modes).
- Store split into `types.ts` (contract), `runtime.ts` (ids, active workspace, persistence switch) and nine slices (`session`, `remote`, `menu`, `floor`, `order`, `settings`, `inventory`, `calendar`, `staff`). The split was mechanical: each action was moved verbatim.
- Local/Supabase parity: local mode runs the same domain rules the SQL enforces. `supabase/tests/parity.test.ts` feeds identical scenarios to both (14 checkout scenarios, 7 transition sequences, 12 booking requests) and requires the same accept/reject, totals, stock and table outcomes. Local station actions enforce the same permission rule as the server.
- Direct `useStore.setState` outside the store removed (realtime, bootstrap, station and customer pages use `hydrateCustomerContext`, `hydrateStationContext`, `applyRemote*`, `mergeRemoteOrders`).
- Realtime: the admin channel also listens to `tables`. The tab-visibility refresh merges by id, so an order finished while the tab was hidden is updated instead of dropped. Stations poll a session-gated RPC every 10 s; the customer menu polls the minimized RPC every 30 s. No anon table access is needed.
- **NOT DONE**: a full `localAdapter`/`supabaseAdapter` pair behind one interface for plain CRUD (menu items, tables, calendar, staff). Business-critical paths (checkout, transitions, stock, settings, stations, booking) already go through shared domain rules and services with parity tests. The remaining CRUD actions still branch per action on `usesSupabasePersistence()`. Converting them touches every slice, so it was left out of this already large change; the slices make it a per-file follow-up.

### Phase F — UI cleanup
- Mechanical per-component splits: `pages/customer/menu/`, `pages/admin/{calendar,tables,menu-manager,stations,orders}/`, `pages/station/kitchen/`. Menu 1,480 → ~700 lines, Calendar 1,940 → ~960, Tables 1,730 → ~720, MenuManager 1,160 → ~260. A render smoke test covers every admin page.
- Dead code removed after re-verification: `App.css`, `NavLink.tsx`, `use-mobile.tsx`, placeholder test, unused React Query provider, `autoMigrations.ts` + `pushLocalToSupabase` (production has 0 base64 images, checked read-only), base64→Storage migration code, unused store/bridge helpers, 47 unused imports/locals surfaced by `noUnusedLocals`.
- npm is the only package manager (stale `bun.lock`/`bun.lockb` removed; `packageManager` + `engines`; CI uses `npm ci`). `.gitattributes` normalizes line endings to LF.

### Phase G — gates
- TypeScript: full `strict` (including `noImplicitAny`) plus `noUnusedLocals`/`noUnusedParameters`, with 0 errors, no `any` added and no `@ts-ignore`.
- CI: `.github/workflows/ci.yml` runs `npm ci → lint → typecheck → test → test:db → build`, then Playwright smoke.

## Security fixes

| Audit finding | Fix | Evidence |
|---|---|---|
| SEC-01 anon reads all orders/tables | 015 drops the policies | `orders-rls.test.ts` (13 tables, cross-tenant) |
| SEC-02 checkout trusts quantity/modifier price | 016 | `checkout.test.ts` (22 tests), `parity.test.ts` |
| SEC-03/07 station RPCs need only the token; any status | 018/022 sessions + permissions + state machine | `stations.test.ts` (15 tests) |
| SEC-04 PINs public/plaintext | 018 hashes, 019 removes from customer RPC | `stations.test.ts`, `public-surface.test.ts` |
| SEC-05 booking self-approve / closure | 020 | `public-surface.test.ts` |
| SEC-06 roster PII | 019 | `public-surface.test.ts` |
| SEC-08 customer menu over-exposure | 019 | `public-surface.test.ts` |
| SEC-09 search_path | 021 | privilege tests |
| SEC-10 legacy overload | 016 | `checkout.test.ts` |
| SEC-11 PII in URL / notes | structured fields, sessionStorage | E2E delivery test, component tests |
| (new) PUBLIC EXECUTE on internal definer helpers | 021 allow-list + default privileges | privilege tests |
| SEC-16 TRUNCATE etc. for API roles | 021 | `orders-rls.test.ts` |
| SEC-14 local-mode plaintext passwords | unchanged | DECISION (local/demo mode future) |
| SEC-15 leaked password protection | dashboard setting | REQUIRES owner action in Supabase Auth settings |
| SEC-12 request rate limiting | station PIN lockout implemented; booking lookup requires phone + 8-hex code | NOT DONE for generic RPC rate limits: needs an API gateway/Edge Function in front of PostgREST |

## Database/migrations

| # | Purpose |
|---|---|
| 003 | replay repair (`text[]` functions); production already has the effect |
| 014 | replay repair (publication membership made conditional) |
| 015 | reconstruct drifted objects, align column types, drop anon policies, structured order fields, idempotency key, payment status, constraints (NOT VALID) |
| 016 | authoritative `atomic_checkout` |
| 017 | state machine trigger, `transition_order_internal`, `advance_order`, `cancel_order`, `adjust_stock`, `patch_settings` |
| 018 | station tables, hashing, sessions, station RPCs, owner station RPCs |
| 019 | public RPC minimization (menu, booking data, roster, receipt) |
| 020 | booking hardening + lookup |
| 021 | privilege hardening |
| 022 | `station_get_context` |
| 023 | validate constraints |
| 024 | payment recording: `record_payment`, `station_record_payment`, `get_order_status` returns `placedAt`/`paymentStatus`, `paid_at` default dropped, station `canRecordPayments` backfill |

Release verification also changed 015 (fulfillment status `paid` → `placed`, `order_channel` backfill, duplicate production policy dropped, one id default) and 016–018 (use `placed`). None of these files has been applied to production.

Migration discipline:
- Every change is a new numbered file. It must replay in `npm run test:db`, pass the production-parity test and pass `supabase/preflight/production_preflight.sql` before any production apply.
- Production migration history uses timestamp versions (`20260413…`); the repository uses `001…023`. The two have never matched: 001 was applied outside tracking, and 16 migrations were applied only remotely. **Do not run `supabase db push` against production**: it would treat 001–014 as unapplied and fail or duplicate objects.

## Tests added

| Suite | Command | Count |
|---|---|---|
| Unit + component (jsdom) | `npm test` | 133 tests / 10 files (was 91) |
| DB: migrations, parity with production, checkout, RLS/orders, stations, public surface/booking/privileges, TS↔SQL parity, client↔DB RPC contract | `npm run test:db` | 140 tests / 7 files (new) |
| E2E smoke (Playwright) | `npm run test:e2e` | 6 tests: admin shell, dine-in QR, takeaway, delivery, admin advance, booking (new) |

Required security regression set: every item in the brief is covered (anon orders/tables, cross-tenant, negative/zero quantity, fake modifier, forged price, partial cart, station RPC without session, station permissions, invalid transition, station cancel restocks once, booking self-approve, closure, max/day, roster PII, menu PIN/cost/recipe, idempotent checkout).

Concurrency caveat: PGlite is a single connection. The "two orders for the last unit" and "same idempotency key twice" tests run through `Promise.all` but are serialized by the engine. The SQL relies on `FOR UPDATE` row locks plus a unique index, which are correct under real concurrency, but a truly parallel test needs a server Postgres. **REQUIRES** Docker / local Supabase (`supabase start`) or a CI Postgres service.

## Architecture changes

```
src/domain/     pure rules (no React/IO): ordering, booking, time, stations, orderMachine
src/services/   IO: workspaceService (owner RPCs), stationService, bookingService
src/store/      Zustand: types.ts (contract), runtime.ts, slices/*, workspace.ts (local serializer),
                hydration.ts (Supabase load), bridge.ts (plain CRUD writes)
supabase/       migrations/, tests/ (PGlite harness), preflight/, config.toml
```

Local vs Supabase: one set of domain rules. In Supabase mode the database is authoritative and the browser only mirrors rules for UX. In local/demo mode the same rules decide. Parity tests keep them identical.

## Behavior changes

| Change | Why |
|---|---|
| Takeaway/delivery schedule step works (was a crash) | bug fix |
| Checkout rejects qty ≤ 0, non-integer, > 100, unknown/duplicate modifiers, missing required, too many selections, disabled channel, outside hours, bad schedule, dine-in without a valid table QR | server authority |
| New orders have `payment_status = 'unpaid'`; only "Pay on Pickup / on Delivery / at the Table" is offered; old orders are `legacy_unverified` | no payment provider exists, so no order should be marked as charged |
| Generic "Dine In" option removed from the mode selector; dine-in only via table QR | the portal has no table picker (see DECISION) |
| `/menu` shows the paused/closed screen for QR orders too | consistency with the portal |
| Delivery address no longer in URLs; stored per tab | PII |
| Booking: customer gets a confirmation code; status lookup needs phone + code; server decides pending/approved | privacy + authority |
| Stations: PIN is checked by the server; the device keeps a 12 h session; "Lock" logs out server-side; PIN field in admin is write-only (blank keeps it, explicit "Remove PIN") | real auth |
| Station and customer screens poll (10 s / 30 s) instead of anon realtime | anon table access removed |
| Rework in local mode sends `ready → preparing` (was: advanced to completed) | parity with the server |
| Admin "cancel" restores stock in the database (was only in the browser) | bug fix |
| Business dates/hours use the restaurant timezone | bug fix |
| Supabase admin loads the last 90 days of orders plus all active orders; receipts are no longer preloaded | same retention as local mode; performance |
| Supabase `patch_settings` rejects unknown timezones | validation |

## Backward compatibility

- Existing orders keep their data. New columns default safely (`customer_*` empty, `order_channel` `dine-in`, `payment_status` `legacy_unverified`). `served` rows (0 in production) map to `completed`.
- Existing stations: the backfill keeps ids, names, roles, colors and permissions, hashes existing PINs and scrubs plaintext. Station URLs stay the same.
- Existing bookings keep working in admin. Lookup by phone only is replaced by phone + code (old bookings have no code; customers contact the restaurant).
- `business_settings.stations` is kept (without `pin`) for rollback. Nothing reads it after 018.
- **Frontend and database must be deployed together.** The new frontend calls the new RPC signatures (`atomic_checkout` with `p_client_order_id`, `submit_booking` without `p_status`, `station_login`, …), and the old ones are dropped by the migrations. An old frontend against the new database cannot check out, and the reverse also fails.

## Production migrations NOT applied

No migration was applied to production. **Correction:** during an interrupted apply attempt on 2026-09-27, one write happened: schema `backup_20260927` was created in production with copies of the public tables (15 relations). It is not reachable by `anon`/`authenticated` (no USAGE), and the public schema is unchanged (verified read-only). The owner decides when to drop it. Everything else was read-only.

**REQUIRES explicit owner approval and a maintenance window.** Runbook:
1. Run `supabase/preflight/production_preflight.sql` (read-only); every column must be 0.
2. Take a backup (Supabase dashboard → Database → Backups / `pg_dump`).
3. Apply `015` … `023` in order: SQL editor, `psql`, or MCP `apply_migration` one file at a time. Each file is one transaction. Do **not** use `supabase db push` (history mismatch, see above).
4. Deploy the frontend from this branch immediately after.
5. Re-run the Supabase security advisors. Expected: no `function_search_path_mutable`; anon-executable definer functions limited to the allow-list in 021.
6. Optional, separate approval: `supabase migration repair` to align remote history with repository file names.
7. Supabase Auth settings: enable leaked-password protection.

## Remaining blockers

| Item | Status |
|---|---|
| Apply migrations 015–023 to production | REQUIRES approval + maintenance window (runbook above) |
| Remote migration history repair | REQUIRES approval (mutates remote history) |
| `supabase db reset` with the CLI | BLOCKED: Supabase CLI and Docker unavailable here; replay is verified with PGlite |
| Truly parallel DB concurrency tests | DONE: `npm run test:pg` on real PostgreSQL 17 (see readiness doc) |
| GitHub Actions run | READY: workflow committed; the branch was not pushed (publishing needs the owner's go-ahead) |
| E2E in CI | READY: CI installs Playwright Chromium. Locally, `PW_CHANNEL=chrome` reuses an installed Chrome (no browser download was done) |
| Generic RPC rate limiting | NOT DONE: needs an API gateway or Edge Function in front of PostgREST; station PIN lockout and booking-code entropy are in place |
| Local mode plaintext passwords | DECISION: tied to whether local/demo mode stays |
| Text `date`/`time_slot`/`scheduled_for` columns → `date`/`time`/`timestamptz` | NOT DONE: preflight shows clean data, but every client mapper and RPC uses strings. Migrating the type is a separate, coordinated change; validation is enforced in the RPCs meanwhile |
| Full CRUD persistence adapters | NOT DONE (see Phase E); the business-critical paths are covered |
| Owner "mark as paid" | DONE (024): owner and service stations record in-person payments; provider choice still open |
| Delivery map (TODO #2) | unchanged |

## Product decisions required

1. **Generic dine-in**: the generic "Dine In" option was removed (it led to a dead end). Keep dine-in as table-QR only, or restore a table picker in `/order/:token`?
2. **Local/demo mode**: keep it long-term, as demo-only, or remove it? It doubles the cost of every feature and keeps plaintext local passwords.
3. **Payment provider**: which PSP, and should staff be able to mark orders as paid meanwhile? The `payment_status` field is ready for it.
4. **Public roster**: should the staff roster be public at all (names and shifts), or behind a staff login?

## Commands and results

Final run after a clean `npm ci` (2026-09-27):

| Command | Result |
|---|---|
| `npm ci` | added 505 packages, lockfile unchanged |
| `npm run lint` | 0 errors, 5 warnings (all in shadcn `src/components/ui/*`, left untouched by convention) |
| `npm run typecheck` | pass (strict + noUnused*) |
| `npm test` | 133 passed (10 files) |
| `npm run test:db` | 140 passed (7 files) |
| `npm run build` | pass |
| `PW_CHANNEL=chrome npm run test:e2e` | 6 passed |

## Commits

```
b646661 fix(hydration): one canonical workspace (de)serializer for login, refresh and logout
13dbcd5 fix(ordering): portal crash, restaurant-timezone scheduling, PII out of URLs
7565cb6 feat(ui): app-level error boundary with recoverable fallback
b647d9c build: typecheck gate, strictNullChecks, standard Playwright config
bda6513 db: reconstruct drifted schema; authoritative checkout and order operations
a173921 test(db): in-process Postgres harness; migration chain replays and matches prod
3e21797 test(db): checkout validation, all-or-nothing and idempotency
daa2a8a fix(db): one rework-aware transition rule; RLS and order-operation tests
d6909ba feat(db): server-verified station sessions and permissions
d4307a5 feat(db): minimize public RPCs, harden booking, least-privilege grants
9b423dc refactor(orders): shared checkout/transition rules; store uses server RPCs
0753b71 feat(stations): devices use server sessions; PINs are write-only
5d55638 feat(booking): server-decided status, confirmation code, private lookup
91ab5c6 refactor(realtime): store actions only, tables events, lossless tab refresh
ff65068 fix(dates): restaurant-timezone days in admin; structured customer info
23fc4a7 test(e2e): Playwright smoke for the critical paths
3baeb90 ci: lint, typecheck, unit, DB and E2E gates; npm as the only package manager
72d4783 db: validate data constraints; production preflight query
a58394d build: full TypeScript strict mode with unused-code checks
5ce92b6 refactor(store): split the 1,300-line store into domain slices
44bb9d5 refactor(ui): split Menu, Calendar and Tables into per-component modules
06e8b5b refactor(ui): split MenuManager, Stations, Orders and KitchenStation
c60b9dd test(db): client/database RPC contract
```
The first five commits include work started by an earlier session on this branch, completed and verified here. Documentation is committed last.

## Final readiness status

```
[x] npm install/npm ci reproducible
[x] one canonical package manager
[x] npm run lint green (0 errors)
[x] npm run typecheck green
[x] npm test green
[x] build green
[x] Playwright works
[x] critical E2E smoke green
[x] fresh Supabase DB reproducible from repo        (PGlite replay + prod parity; CLI reset BLOCKED)
[x] DB security tests exist
[x] anon cannot directly read orders                (in migrations; production NOT applied)
[x] anon cannot directly read tables                (in migrations; production NOT applied)
[x] checkout cannot forge quantity/prices/modifiers
[x] checkout is all-or-nothing
[x] checkout is idempotent
[x] station PIN is not public
[x] station operations require server session
[x] station permissions server-enforced
[x] booking cannot self-approve
[x] booking cannot create closure
[x] roster does not leak phone/email
[x] local hydration does not lose data
[x] Supabase hydration does not lose stations
[x] cancel restores stock consistently
[x] order transitions server-enforced
[x] restaurant timezone used for business dates
[x] local/Supabase critical behavior has parity tests
[x] CI gates typecheck/tests/build                  (workflow committed; not yet run on GitHub)
[x] documentation matches actual code
```

The codebase is ready for feature work behind these gates. Production gets these guarantees only after the migrations and frontend are deployed together (runbook above).
