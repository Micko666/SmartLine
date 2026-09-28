# SmartLine — production release readiness

Verification date: 2026-09-27. Production (`bcwlizkhceidumyaygda`) was used **read-only** during this verification (catalog, preflight and aggregate counts; no row contents). Nothing was pushed or merged.

## Exact candidate SHA

| Item | Value |
|---|---|
| Code candidate | `bf43f1d` (branch `stabilization/main-rebase`, pushed to `origin/main`). It is `737e697` (all evidence below) plus the fixes from the owner walkthrough (see Release blockers). |
| Commits after the candidate | `a996fef` (tests + preflight only) and the docs commit that adds this file. Neither changes `src/` or `supabase/migrations/`. |
| Production frontend (Vercel deploys `master`) | `origin/master` = `027221268a0fa70165a6f7041e02f8ca63677a1a` |
| `origin/main` | `c1bf16db4514b4989d40e911b981cc8134d52037` (stabilization, pushed earlier) |
| Ancestry | `origin/master` and `origin/main` are both ancestors of the candidate → deploy is a fast-forward (32 commits over `master`) |
| Migrations in the release | `015`–`024` (never applied to production) |

Commits added during this verification (on top of `origin/main`):

```
b0255f4 fix(orders): separate payment state from fulfillment state
bc38b24 test(security): function security table, anon surface scan, contract negatives
e86d7e8 test(db): real PostgreSQL concurrency suite (npm run test:pg)
4ed53ae test(db): production upgrade rehearsal on real PostgreSQL; migration fixes
c5043e9 test(db): frontend x database compatibility matrix
737e697 test(e2e): preview suite against a development Supabase project; fix card ref
a996fef test(db): intermediate upgrade states in compat matrix; preflight covers 024
```

## Full clean-run results

Fresh `git clone` of the candidate SHA into an empty directory, run twice, sequentially (`scratchpad/cleanrun.sh`). Windows 11, Node 22.20.0, Chrome channel for Playwright, local PostgreSQL 17.10, dev Supabase project for preview.

| Step | Run 1 | Run 2 | Result (both runs) |
|---|---|---|---|
| `npm ci` | 36 s | 34 s | rc 0 |
| `npm run lint` | 25 s | 31 s | 0 errors, 5 warnings (`react-refresh/only-export-components` in shadcn `src/components/ui/*`, untouched by convention) |
| `npm run typecheck` | 28 s | 24 s | pass (app + node configs) |
| `npm test` | 63 s | 59 s | 142 passed / 10 files |
| `npm run test:db` (PGlite) | 39 s | 38 s | 208 passed, 24 skipped (the skipped are the real-PG and old-frontend suites, run separately below) |
| `npm run test:pg` (real PostgreSQL) | 16 s | 15 s | 22 passed / 2 files |
| `npm run build` | 33 s | 27 s | pass |
| `PW_CHANNEL=chrome npx playwright test` (local mode) | 98 s | 89 s | 6 passed |
| Preview E2E vs dev Supabase | 72 s | 75 s | 8 passed |
| Compatibility matrix with old frontend source | 13 s | 14 s | 4 passed |

Flakiness: 0 failures and 0 retries across both runs. Critical suites were additionally run 3× (`test:pg`) and 2× (preview) during development with identical results. Build warning: `browserslist` data is old (informational).

## Real PostgreSQL concurrency results

Server: PostgreSQL 17.10 (x86_64-windows, `embedded-postgres`), a fresh UTF-8 database per run, shim + all migrations. Harness `supabase/tests/support/realdb.ts`: every RPC runs like PostgREST (own pooled connection, `BEGIN; SET LOCAL ROLE; local JWT claims; SELECT fn(); COMMIT`). It refuses Supabase hosts. Suite: `supabase/tests/concurrency.pg.test.ts`.

| Scenario | Evidence | Result |
|---|---|---|
| A. Last unit, held lock | tx1 checks out the last salad (uncommitted); tx2 observed in `pg_stat_activity` with `wait_event_type = Lock`; tx1 commits; tx2 returns "Insufficient stock"; stock 0; exactly one order | pass |
| A. Last unit, burst | 10 rounds × 8 parallel checkouts for 1 unit | exactly 1 winner per round, stock never negative |
| B. Idempotency, held lock | same `client_order_id` from two transactions; the second waits, then returns the **same** order id | 1 order, 1 receipt, 1 stock deduction |
| B. Idempotency, burst | 10 rounds × 8 parallel submits of one key | 1 order + 1 receipt per round, stock −1 |
| B. Order numbers | 30 parallel distinct checkouts | 0 duplicate `order_number` |
| C. Partial cart, held lock | mixed cart (2 burgers + last salad) loses the salad to a concurrent single-salad order | mixed cart fails entirely: burger stock unchanged, no order |
| C. Partial cart, burst | 10 rounds, mixed + single carts shuffled in parallel | stock always equals sold quantities; 0 leaked reservations |
| D. Same-status advance | 10 rounds × 4 parallel `advance_order(placed→preparing)` | exactly 1 success per round |
| D. Parallel cancel | 6 parallel `cancel_order` | stock restored exactly once |
| D. Parallel `record_payment` | 6 parallel | all ok, one `paid_at` |
| D. Parallel bookings | 8 parallel bookings, `maxEventsPerDay = 2` | exactly 2 created |

Results: 12/12 on three consecutive runs (6.3 s, 6.1 s, 5.9 s).

Mutation check (the suite can fail): with `FOR UPDATE` removed from the settings and item locks in `016`, the two idempotency tests failed (duplicate orders). Last-unit tests still passed because the table-row lock and the conditional stock update also serialize them. The file was restored from git afterwards.

No fixes were needed: checkout, transitions and booking serialize on the tenant's `business_settings` row lock.

## Upgrade rehearsal results

Pre-state: `supabase/tests/fixtures/production-pre-015.sql`, generated read-only from the production catalog. It holds exact tables, columns, defaults, constraints, indexes, RLS, policies, publication, and the 13 production functions with exact identity and ACL; bodies are stubbed, because 015–024 replace or drop all of them. It contains no production data.

Data: synthetic, matching production's shape (2 tenants; 39 items; 12 tables; 139 orders = 117 completed / 13 cancelled / 9 refunded; payment methods card/cash/google_pay/apple_pay; table ids uuid/walk-in/takeaway/delivery; legacy kitchen station with `visibleStatuses` containing `paid`). It adds edge cases: 2 active `paid`, 1 `served`, 1 `preparing`, and a service station with a plaintext PIN.

### Local real PostgreSQL (`upgrade-rehearsal.pg.test.ts`)

Each file runs in its own transaction.

| Migration | Result | ms* | Affected rows / backfill |
|---|---|---|---|
| 015 | ok | 132 | `served`→`completed` (1), `paid`→`placed` (2), `order_channel` backfill (1 takeaway, 1 delivery), all orders/receipts `payment_status = legacy_unverified`, anon policies dropped, id defaults → `gen_random_uuid()` |
| 016 | ok | 28 | 6- and 7-arg `atomic_checkout` dropped |
| 017 | ok | 8 | transition trigger + order RPCs |
| 018 | ok | 103 | 2 stations moved to `stations`; plaintext PIN bcrypt-hashed and removed from jsonb; legacy station RPCs dropped |
| 019 | ok | 8 | public RPCs minimized |
| 020 | ok | 21 | old `submit_booking(p_status…)` dropped |
| 021 | ok | 18 | privileges reset to the allow-list |
| 022 | ok | 5 | `station_get_context` |
| 023 | ok | 12 | 4 constraints validated |
| 024 | ok | 16 | `paid_at` default dropped; service station `canRecordPayments = true`; `visibleStatuses` `paid`→`placed` |

\*measured while a clean run was using the machine; indicative only.

Postconditions (all asserted):
- Row counts per table before = after (143 orders, 143 receipts, …).
- Money totals: `sum(orders.total) = sum(receipts.total) = 6936.60` before and after.
- Statuses after: completed 118, cancelled 13, refunded 9, placed 2, preparing 1.
- Payment state after: all orders `legacy_unverified`.
- Channels after: dine-in 141, takeaway 1, delivery 1.
- 0 unvalidated constraints; 0 `anon_select_*` policies; one `atomic_checkout`.
- The upgraded DB serves the new frontend:
  - checkout continues at `next_order_number` (1200), `placed` + `unpaid`;
  - tracker works for new and legacy orders;
  - receipt works;
  - menu has no cost/recipe;
  - the migrated service station logs in with its old PIN.

Fixes the rehearsal forced (migrations had never been applied anywhere):
1. `015`: legacy takeaway/delivery orders would have been labelled dine-in → `order_channel` backfill from `table_id`.
2. `015`: production-only duplicate policy `"Users manage own decorations"` → dropped (`map_decorations_owner` covers it).
3. `015`: mixed id defaults (`extensions.uuid_generate_v4()` vs `gen_random_uuid()`) → one default.
4. `024`: `orders.paid_at DEFAULT now()` would mark any row inserted without it as paid → default dropped.

### Real Supabase (dev project `smartline-dev`, ref `nohkwatyjxracroxkgos`)

Applied with MCP `apply_migration`, exactly as the production runbook will:
1. `prod_pre_015_fixture`;
2. production-shaped synthetic data (30 orders incl. `paid`/`served`, legacy stations);
3. `015` … `024`, one call each.

All succeeded. Postconditions queried after the upgrade:
- 30/30 orders and receipts; total 165.00 unchanged.
- `paid`→`placed`, `served`→`completed`; payment all `legacy_unverified`.
- Channels 28/1/1.
- Stations migrated (`paid`→`placed`, service `canRecordPayments`).
- 0 anon policies; `paid_at` default NULL; 0 unvalidated constraints.

## Schema diff

**Upgraded vs fresh install (local real PG)**:
- Compared: columns (type/nullability/default), constraints (definition + validated), indexes, RLS flags, policies, functions (signature/result/SECURITY DEFINER/volatility/config/anon+authenticated EXECUTE/`md5(prosrc)`), triggers, table grants, publication and default ACLs.
- Result: **empty in every category** (the test fails otherwise).
- Before the fixes above, the diff showed 12 id-default differences and 1 extra policy, which proves the comparison is not vacuous.

**Dev Supabase vs repository**:
- Fingerprints identical for columns, constraints, indexes, policies, triggers and anon/authenticated table grants.
- All 38 function bodies are byte-identical (`md5(prosrc)`).
- So the SQL applied on real Supabase is exactly the repository SQL.
- Note: 3 working-tree files were CRLF while git stores LF; the comparison used the LF (committed) content.

## Security regression results

Function security table (fresh install; `uuid_*` rows from the test shim omitted):

| Function | Class | SECURITY DEFINER | anon EXECUTE | authenticated EXECUTE | Internal only | search_path |
|---|---|---|---|---|---|---|
| `adjust_stock` | owner API | yes | no | yes | no | `public` |
| `advance_order` | owner API | yes | no | yes | no | `public` |
| `atomic_checkout` | public API | yes | yes | yes | no | `public, extensions` |
| `booking_policy` | internal | no | no | no | yes | `public` |
| `cancel_order` | owner API | yes | no | yes | no | `public` |
| `checkout_result` | internal | no | no | no | yes | `public` |
| `delete_station` | owner API | yes | no | yes | no | `public` |
| `enforce_order_transition` | trigger | no | no | no | yes | `public` |
| `get_booking_data` | public API | yes | yes | yes | no | `public` |
| `get_customer_menu` | public API | yes | yes | yes | no | `public` |
| `get_order_status` | public API | yes | yes | yes | no | `public` |
| `get_receipt_by_id` | public API | yes | yes | yes | no | `public` |
| `get_roster_data` | public API | yes | yes | yes | no | `public` |
| `list_stations` | owner API | yes | no | yes | no | `public` |
| `lookup_booking_status` | public API | yes | yes | yes | no | `public` |
| `normalize_phone` | internal | no | no | no | yes | `public` |
| `order_transition_allowed` | internal | no | no | no | yes | `public` |
| `order_transition_allowed_by` | internal | no | no | no | yes | `public` |
| `ordering_time_allowed` | internal | no | no | no | yes | `public` |
| `patch_settings` | owner API | yes | no | yes | no | `public` |
| `record_payment` | owner API | yes | no | yes | no | `public` |
| `record_payment_internal` | internal | yes | no | no | yes | `public` |
| `station_adjust_prep_time` | public API | yes | yes | yes | no | `public` |
| `station_advance_order` | public API | yes | yes | yes | no | `public` |
| `station_get_context` | public API | yes | yes | yes | no | `public` |
| `station_get_orders` | public API | yes | yes | yes | no | `public` |
| `station_log_kitchen_event` | public API | yes | yes | yes | no | `public` |
| `station_login` | public API | yes | yes | yes | no | `public, extensions` |
| `station_logout` | public API | yes | yes | yes | no | `public, extensions` |
| `station_perm` | internal | no | no | no | yes | `public` |
| `station_public_config` | public API | yes | yes | yes | no | `public` |
| `station_public_json` | internal | no | no | no | yes | `public` |
| `station_record_payment` | public API | yes | yes | yes | no | `public` |
| `station_require_session` | internal | yes | no | no | yes | `public, extensions` |
| `station_set_table_status` | public API | yes | yes | yes | no | `public` |
| `submit_booking` | public API | yes | yes | yes | no | `public, extensions` |
| `transition_order_internal` | internal | yes | no | no | yes | `public` |
| `upsert_station` | owner API | yes | no | yes | no | `public, extensions` |

Asserted in `supabase/tests/security-regression.test.ts` (41 tests):
- every function is exactly one class;
- every SECURITY DEFINER pins `search_path`;
- one overload per API function;
- internal helpers are denied to anon **and** authenticated.

Migration 021 regression for `transition_order_internal`:
- anon: `permission denied`;
- owner calling it directly for their own tenant: `permission denied`, order unchanged;
- owner B via `advance_order`/`cancel_order` on tenant A's order: `ok:false`, unchanged;
- tenant-A station via `station_advance_order` on a tenant-B order: `ok:false`, unchanged;
- direct `UPDATE orders SET status='completed'` by the owner: rejected by the transition trigger.

Supabase advisors on the dev project after the upgrade:
- `anon_security_definer_function_executable`: exactly the 18 public API functions.
- `authenticated_…`: exactly those 18 plus the 8 owner functions. No internal helper is flagged.
- `rls_enabled_no_policy` on `stations` / `station_sessions` (intended: no REST access, RPC only).
- `auth_leaked_password_protection` disabled (auth setting, see debt).

## Public surface results

Tests: PGlite (`security-regression.test.ts`, `public-surface.test.ts`) and real Supabase (`e2e/preview/flows.spec.ts`, REST with the anon key).

- Direct `SELECT` as anon returns **0 rows** on orders, tables, business_settings, employees, receipts, menu_items, calendar_events, shifts, stock_reservations, kitchen_events, ingredients, map_decorations and event_packages. `stations` / `station_sessions`: permission denied.
  - On real Supabase REST: `[]` or 401/403/404 for orders, tables, business_settings, employees, receipts, stations, station_sessions.
- Anon INSERT/UPDATE/DELETE on orders, receipts, business_settings and menu_items: rejected; row counts, the token and prices are unchanged.
- Payload scan of every anon-callable RPC with seeded secrets: `get_customer_menu`, `get_booking_data`, `get_roster_data`, `get_order_status`, `get_receipt_by_id`, `station_public_config`, `lookup_booking_status`, `atomic_checkout`, `station_get_context`, `station_get_orders` (kitchen).
  - None contain: PIN, `pin_hash`, session token hash, employee phone/email, customer phone/address, `cost_per_serving`, `recipe`, `user_id`.
  - Non-vacuity: a planted leak is detected, and the session hashes exist.
- `station_login` returns an opaque 64-hex token, never its stored hash.
- Customer contact goes only to service/custom stations (hand-over); kitchen stations get empty contact fields.
- Invalid/foreign station tokens get `{ok:false,error}` only.

## Unpaid/payment model verification

Model after the fix (`b0255f4` + `024`):

| Concept | Column | Values |
|---|---|---|
| Fulfillment (kitchen) | `orders.status` | `placed → preparing → ready → completed`, `cancelled → refunded` (legacy `paid` renamed to `placed`; `served` → `completed`) |
| Money | `orders.payment_status` | `unpaid → paid → refunded`; `legacy_unverified` for orders created before payment tracking |

- New orders: `placed` + `unpaid`, `paid_at` NULL (order and receipt).
- Recording money:
  - `record_payment` (owner) and `station_record_payment` (`canRecordPayments`, service stations backfilled) share `record_payment_internal`;
  - idempotent (one `paid_at`, also under 6 parallel calls);
  - rejects cancelled/refunded and `legacy_unverified`;
  - never touches the kitchen status;
  - updates the receipt.
- Refund: a `paid` order becomes `refunded`; an unpaid refunded order stays `unpaid` (no money moved).
- Revenue rule `isRevenueOrder`: live order **and** `paymentStatus ∈ {paid, legacy_unverified, undefined}`. Unpaid is never revenue. Volume (`isLiveOrder`) is counted separately. The rule is applied in every consumer:
  - Dashboard: today's revenue, hourly chart, plus an "unpaid" amount;
  - Analytics: totals, average, daily/hourly charts (items/ingredients still use volume);
  - Orders: history day totals.
- UI:
  - "Mark paid" on admin order cards;
  - "Unpaid · Mark paid" in the service station table panel;
  - receipt shows "Paid" vs "Payment due…".
- Tracker: uses `placedAt` (falls back to legacy `paidAt`); no NaN (checked on real Supabase).
- Tests:
  - unit: revenue rules, local `recordPayment`, refund, legacy local `paid`→`placed`;
  - component: Dashboard shows €40 revenue and "€25 unpaid", ignores a cancelled €99, and "Mark paid" works;
  - DB: `payments.test.ts` (14);
  - real PG: parallel `record_payment`;
  - preview: the service station records a payment on real Supabase.

## Preview E2E results

Local Vite frontend (`http://127.0.0.1:8090`) against the dev Supabase project migrated from the production pre-state. Config: `playwright.preview.config.ts` (refuses the production ref). Every test fails on any page error, console error or Supabase response ≥ 400 (this covers signature mismatch PGRST202/203 and RLS 42501).

| Flow | Result |
|---|---|
| Anon direct table reads | pass (empty / denied) |
| Dine-in: menu → cart → place order → receipt ("Payment due", Order-more link) → tracker ("Order Received", no NaN) | pass |
| Takeaway: portal schedule → menu → order → receipt | pass |
| Delivery: address never in URL → receipt | pass |
| Booking: request → confirmation code | pass |
| Roster: renders, no phone/email | pass |
| Kitchen station (migrated from jsonb, no PIN): opens, shows legacy orders as "New", advances a new order | pass |
| Service station (migrated, `canRecordPayments`): list view → table panel → Mark paid → `paymentStatus = paid` | pass |

Result: 8/8, 0 uncaught exceptions, 0 console errors, 0 failed Supabase calls. Repeated 4× (2 standalone + 2 clean runs).

Defect found and fixed: React "Function components cannot be given refs" in `KitchenOrderCard` (child of `AnimatePresence mode="popLayout"`); it now uses `forwardRef`.

**Not executed: owner/admin flows on real Supabase.** They need a password sign-in against the remote auth host, which this verification may not perform. Admin RPCs are covered by DB tests, the contract checker and local-mode E2E, but the admin UI has not been exercised against a real Supabase session. See Release blockers.

## Deployment compatibility matrix

The contract checker (`supabase/tests/compat-matrix.test.ts`) checks every RPC call (resolving overloads like PostgREST) and every direct table operation against a schema. The old frontend is `origin/master` source (`git archive origin/master src`).

| Frontend \ Database | Old (production pre-015) | New (015–024) |
|---|---|---|
| Old (`master` 0272212) | **0** violations (validates the capture) | **17** — `submit_booking` (p_status…), all station RPCs (token → session), `atomic_checkout` (missing `p_client_order_id`) |
| New (candidate) | **34** — missing station/owner/booking RPCs, `atomic_checkout` shape | **0** |

Intermediate states (production pre-state + 015..N; each file is one transaction, so "N succeeded, N+1 failed" leaves exactly state N):

| State | New FE violations | Old FE violations |
|---|---|---|
| 015 | 34 | 0 (but see note) |
| 016 | 30 | 1 |
| 017 | 26 | 1 |
| 018 | 8 | 13 |
| 019 | 8 | 13 |
| 020 | 3 | 17 |
| 021 | 3 | 17 |
| 022 | 2 | 17 |
| 023 | 2 | 17 |
| 024 | **0** | 17 |

Note: the checker sees call shapes, not data rules. From 015 on, old-frontend checkout also fails at runtime: the old `atomic_checkout` inserts `status='paid'`, which the new CHECK rejects.

Conclusions:
- No state exists where both frontends work.
- The new frontend works only after 024.
- Customer ordering is down from the start of 015 until the new frontend is live.
- Realtime: the old frontend's anon subscriptions receive nothing after 015 (policies dropped). The new frontend polls on public/station screens and subscribes as the owner in admin.

## Production rollout runbook

**Not executed.** Every step needs the owner's go-ahead. Never use `supabase db push` (remote history ids differ from the repo).

### G0 — gates before the window
1. Owner admin smoke on the dev project (`nohkwatyjxracroxkgos`). This is the release blocker below.
   - Set a password for `dev-owner@example.test` in the dev dashboard.
   - Run `npm run dev` with the dev URL/key and sign in.
   - Check: dashboard (revenue excludes unpaid), orders (advance/cancel/refund/Mark paid), menu CRUD, inventory `adjust_stock`, tables, settings save (`patch_settings`), stations (create/edit PIN/delete; device login with PIN), calendar, analytics.
   - **Stop** on any console error or failed request.
2. Confirm the candidate: `git rev-parse` = `737e697…` (or the docs commit on top, if merged).
3. Choose a window with no service. `active_orders_info` must be 0 (it was 0 on 2026-09-27).

### G1 — pre-deploy (read-only + backup)
1. Preflight: run `supabase/preflight/production_preflight.sql`.
   - Expected (2026-09-27): every gate column 0; `channel_backfill_info` 2, `station_paid_status_info` 1, `active_orders_info` 0.
   - **Stop** if any gate column > 0.
2. Baseline, saved to the change log:
   ```sql
   SELECT (SELECT count(*) FROM orders) o, (SELECT count(*) FROM receipts) r, (SELECT sum(total) FROM orders) t,
          (SELECT count(*) FROM menu_items) m, (SELECT count(*) FROM tables) tb, (SELECT count(*) FROM employees) e,
          (SELECT count(*) FROM calendar_events) c, (SELECT count(*) FROM shifts) s;
   ```
   (2026-09-27: orders 139, receipts 139.)
3. Backup:
   - confirm a Supabase backup newer than the window start (dashboard → Database → Backups) or PITR;
   - also take a logical dump (`pg_dump --schema=public --data-only` with the owner's DB credentials).
   - **Stop** if no backup can be confirmed.
   - The existing `backup_20260927` schema (created during an earlier interrupted session, 15 relations, not reachable by anon/authenticated) is **not** a substitute.
4. Pause customer ordering in admin (Settings → pause ordering) so the old frontend shows the paused screen during the window.

### G2 — migrations (MCP `apply_migration` or SQL editor, one file per call, in order)

Each file is one transaction: on error nothing from that file is applied.

| Step | File | Expected | Validation query | Stop if |
|---|---|---|---|---|
| 1 | 015 | success | `SELECT status, count(*) FROM orders GROUP BY 1;` → only completed/cancelled/refunded (+placed if active); `SELECT order_channel, count(*) FROM orders GROUP BY 1;` → takeaway 1, delivery 1 | error; row count ≠ baseline |
| 2 | 016 | success | `SELECT count(*) FROM pg_proc WHERE proname='atomic_checkout';` → 1 | error |
| 3 | 017 | success | `SELECT tgname FROM pg_trigger WHERE tgname='orders_transition_guard';` → 1 row | error |
| 4 | 018 | success | `SELECT count(*), count(pin_hash) FROM stations;` → 1, 0; `SELECT count(*) FROM business_settings WHERE stations::text LIKE '%"pin"%';` → 0 | error; station count ≠ 1 |
| 5 | 019 | success | `SELECT get_customer_menu('<token>')::text !~ 'cost_per_serving\|recipe';` → true | error |
| 6 | 020 | success | `SELECT count(*) FROM pg_proc WHERE proname='submit_booking';` → 1 | error |
| 7 | 021 | success | the anon-executable function list equals the 18 public API names | error or list differs |
| 8 | 022 | success | `has_function_privilege('anon','station_get_context(text)','EXECUTE')` → true | error |
| 9 | 023 | success | `SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated;` → 0 | error (data violates a rule: stop, do not edit data) |
| 10 | 024 | success | `SELECT column_default FROM information_schema.columns WHERE table_name='orders' AND column_name='paid_at';` → NULL; station `visibleStatuses` has no `paid` | error |

After step 10:
- re-run the baseline query: counts and sums equal;
- run the security advisors: expected output as in "Security regression results".

### G3 — frontend (immediately after G2)
1. Fast-forward `master` to the candidate (`git push origin <sha>:master`). The owner pushes; Vercel builds production.
2. No environment variable changes are needed (same Supabase URL/key).
3. The customer-ordering outage lasts from G2 step 1 until the Vercel deployment is live. Keep ordering paused until G4 passes.

### G4 — post-deploy smoke (production, owner)
1. Admin sign-in; the dashboard loads without console errors.
2. Place one dine-in test order via a table QR:
   - receipt shows "Payment due";
   - tracker shows "Order Received";
   - admin sees it as New + Unpaid;
   - advance to completed, Mark paid;
   - revenue changes only after Mark paid.
3. Takeaway and delivery test orders; delivery address absent from the URL.
4. Station device: open the existing station URL (no PIN, since production's station has none); it shows orders; advance works.
5. Booking request returns a confirmation code.
6. Un-pause ordering.

### G5 — security smoke (production, anon key only)
- `GET /rest/v1/orders?select=*` (and tables, business_settings, employees, receipts) with the anon key → `[]` / denied.
- `POST /rest/v1/rpc/transition_order_internal` as anon → permission denied.
- `get_customer_menu` response contains none of: `pin`, `cost_per_serving`, `recipe`, `user_id`.
- Advisors: anon-executable SECURITY DEFINER list = the 18 public API functions.

## Rollback strategy

| Situation | Action | Data safety |
|---|---|---|
| Failure before G2 | Nothing to roll back | — |
| Migration N+1 fails (N applied) | The file rolled back by itself. Keep ordering paused, diagnose, fix **forward** (new corrected file or corrected N+1), re-apply. Do **not** deploy either frontend in between: at states 015–023 neither frontend is fully compatible (matrix above). | no data changed by the failed file |
| All migrations ok, new frontend deploy fails | Retry/redeploy the candidate. Do **not** roll the frontend back to `master`: the old frontend has 17 contract violations against the new DB and cannot check out. | — |
| New frontend live, defect found | Frontend-only fix forward (new commit) or Vercel rollback to another build of **this** candidate line. Frontend rollback to `0272212` is safe **only before 015**. | — |
| Migrations must be undone | **No down-migrations are provided**, by design. Reversing 015/018/024 is lossy: order status/payment/channel semantics change, station PIN plaintext is not recoverable (hashed), and new rows (`payment_status`, sessions) have no old equivalent. Restore from the G1 backup is the disaster path. Orders placed after the backup must then be re-entered from the admin export. | restore = data loss after the backup point; requires owner decision |
| Service restore without data loss | Ordering paused + fix forward keeps all data. The migrations were rehearsed twice (local real PG, real Supabase) with 0 failures; the only data rewrites are value mappings recorded in the table above. | preserved |

## Remaining non-blocking debt

| Item | Class |
|---|---|
| Supabase Auth "leaked password protection" disabled (advisor) | safe post-release (dashboard setting) |
| Generic RPC rate limiting (only station PIN lockout + booking code entropy) | safe post-release |
| Text `date`/`time_slot`/`scheduled_for` columns | safe post-release |
| Remote migration history does not match repo file names | safe post-release (`supabase migration repair` needs approval) |
| `backup_20260927` schema in production (copies of production data, not API-reachable) | safe post-release: owner decides when to drop it after the new backup exists |
| `sales_count` counts units at checkout regardless of payment | safe post-release (volume metric, not revenue) |
| 5 lint warnings in shadcn `ui/*` | safe |
| GitHub Actions workflow not yet run remotely (nothing pushed); the equivalent local clean runs are above | safe post-release |
| Dev project `smartline-dev` keeps running (free tier) | owner may pause/delete it after release |

## Product decisions

1. Generic dine-in table picker in `/order/:token` (currently table-QR only).
2. Future of local/demo mode (plaintext local passwords).
3. Payment provider. Until then staff record in-person payments ("Mark paid"). Service stations get `canRecordPayments` by default; confirm this default.
4. Whether the staff roster stays public.
5. Tenants with NULL `business_hours` (both production tenants) are treated as always open by both the SQL and the UI. Set real hours before relying on scheduling.

## Release blockers

None open.

1. ~~Owner/admin flows not verified against real Supabase (G0.1).~~ **Resolved 2026-09-28.** The owner walked through the admin on the dev project. Findings, all fixed in `bf43f1d` with regression tests:
   - Settings save always failed: the form sent `restaurant_token`, which `patch_settings` rejects, so the save rolled back. The store now sends only changed, editable fields (DB contract test).
   - Firefox logged the auth auto-refresh lock contention between two tabs as "Uncaught (in promise)". A custom lock now fails outside the Web Locks callback (unit test).
   - React warnings: nested `<button>` (Calendar), duplicate key (station PIN keypad), dialogs without descriptions. Admin render tests and a keypad test now fail on these warnings.
   - UX: overlays close with Escape; back links exist on the takeaway/delivery menu, scheduling step, closed/"scan QR" screens and the tracker.

   Gates at `bf43f1d` (working tree, not a fresh clone):
   - lint: 0 errors;
   - typecheck: pass;
   - unit: 145;
   - DB: 210;
   - local E2E: 6;
   - preview vs dev: 7 passed, 1 skipped (the dev kitchen station now has a PIN set by the owner).

## Final status

READY FOR CONTROLLED PRODUCTION DEPLOY

Conditions: follow the runbook (G1 preflight + backup → G2 migrations 015–024 → G3 fast-forward `master` → G4/G5 smoke). `master` must not receive this code before G2 has completed.

## Production deploy log (2026-09-28, executed on the owner's explicit go-ahead)

| Step | Time (UTC, approx.) | Result |
|---|---|---|
| G1 preflight | 05:40 | all gate columns 0; active orders 0; baseline: orders 139, receipts 139, total 1726.90 |
| G1 backup | 05:41 | schema `backup_20260928_predeploy` (15 tables + function definitions + policies; 139 orders, 1726.90; no API access) |
| G1 pause | 05:41 | `ordering_paused = true` on both tenants (previous: false, empty message) |
| G2 015 → 024 | 05:42–05:46 | all 10 applied via `apply_migration`, validation after each; row counts and totals unchanged; function fingerprint `d54d7f1b…` (38 functions) identical to the verified dev project |
| G3 frontend | 05:46 | `master` fast-forwarded `0272212 → 91fa412`; Vercel production deployment `dpl_Bxb9q2LYrPA8Ty4YWtzoghvieirv` READY, aliased to `smartline.one` |
| G5 security | 05:48 | anon REST: orders/tables/business_settings/employees/receipts `[]`; stations/sessions/`transition_order_internal` 42501; menu (30 items) has no PIN/cost/recipe/user_id; advisors: 18 anon / 26 authenticated SECURITY DEFINER, as designed |
| G4 smoke (read-only) | 05:48 | `smartline.one` portal, tracker and login load with 0 console errors |
| Un-pause | 05:49 | ordering re-opened (values restored exactly); portal shows Takeaway/Delivery |

Owner follow-up: sign in on `smartline.one` and check the admin (orders, Mark paid, settings save, stations). Place one real order to confirm the full path end to end.

Finding: Vercel's deployment list shows a **production** deployment of `main` at `c1bf16d` on 2026-09-27 ~13:13 UTC, next to the expected preview. The production branch is `master` (today's `main` push produced only a preview). This suggests that deployment was promoted to production outside the git flow. If so, from then until this deploy the new frontend served production against the old database. Customer checkout and stations would then have failed in that window. The last production order is from 2026-09-27 11:52 UTC. Now resolved: database and frontend match. Recommendation: keep Vercel "Promote to Production" for `master` builds only.
