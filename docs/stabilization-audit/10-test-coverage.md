# 10 — Test coverage map

## 1. Postojeći testovi (91, svi prolaze)

| Fajl | Testova | Šta pokriva |
|---|---|---|
| `src/tests/orderMachine.test.ts` | 25 | `canTransition`, `transition`, `advance`, `nextStatuses`, `isActiveOrder`, `isRevenueOrder`, labele |
| `src/tests/store.test.ts` | 48 | auth (local), validateCart, checkout (local), stock conflict (reservations), cancelOrder, advanceOrderStatus, menu CRUD, stock ops, tables, settings, getAvailableStock, workspace isolation (local accounts) |
| `src/tests/customerSession.test.ts` | 17 | deviceId, load/save/clear session, TTL, izolacija po tokenu |
| `src/test/example.test.ts` | 1 | `expect(true)` — placeholder |

Ograničenja:
- `vitest.config.ts` postavlja `VITE_SUPABASE_URL=''` → **nijedna Supabase grana nije izvršena u testovima**.
- Nema React component testova (Testing Library je instaliran, ali se ne koristi).
- Nema SQL/RLS testova, nema E2E-a (Playwright config je pokvaren, 02 §4).
- Fixture-i u `store.test.ts` ne odgovaraju tipovima (3 TS greške).

## 2. Matrica

| Feature | Unit | Integration | DB/RLS | E2E | Kritični slučajevi koji nedostaju |
|---|---|---|---|---|---|
| Order state machine | ✔ | ✘ | ✘ | ✘ | server-side tranzicije; `served` status |
| Local checkout | ✔ (store) | ✘ | n/a | ✘ | qty ≤ 0, forged modifier, pause, kanal disabled, parcijalna nedostupnost |
| Supabase checkout (`atomic_checkout`) | ✘ | ✘ | ✘ | ✘ | **sve** — concurrency, stock leak, forged price, negative qty, duplicate submit, 6-arg overload |
| Stock reservations | ✔ local | ✘ | ✘ | ✘ | expiry (TTL), Supabase anon (ne postoji), refresh = nova sesija |
| Cart validation | ✔ | ✘ | — | ✘ | required modifier, maxSelections, više linija istog artikla |
| Customer session | ✔ | ✘ | — | ✘ | restore poslije prve narudžbe |
| OrderPortal / scheduling | ✘ | ✘ | — | ✘ | **render ScheduleStep (bi uhvatio `noSlotsToday`)**, slotovi, buffer, UTC granica, overnight hours, closed day |
| Business hours | ✘ | ✘ | ✘ | ✘ | open/closed, timezone restorana |
| Menu (customer) | ✘ | ✘ | — | ✘ | dine-in QR, mode selector, pause na dine-in, Order More |
| Receipt | ✘ | ✘ | ✘ | ✘ | Supabase fetch, Order More URL |
| Booking | ✘ | ✘ | ✘ | ✘ | approval bypass, closure injection, max/day, guest limit, lookup (local vs Supabase), status badge |
| Roster | ✘ | ✘ | ✘ | ✘ | PII u odgovoru |
| Stations | ✘ | ✘ | ✘ | ✘ | PIN, sesija, permissions, cancel stock, remake smjer, table status persist |
| Admin Orders page | ✘ | ✘ | — | ✘ | carryover, today (local vs UTC) |
| Hydration (AuthProvider) | ✘ | ✘ | — | ✘ | **refresh ne gubi slice-ove (bi uhvatio BUG-03)**, stations u Supabase (BUG-04) |
| Realtime | ✘ | ✘ | ✘ | ✘ | onVisible merge (R4), menu subscription za anon |
| Tenant isolation | ✔ (samo local accounts) | ✘ | ✘ | ✘ | **cross-tenant REST čitanje, anon orders/tables** |
| Settings persistence | ✔ local | ✘ | ✘ | ✘ | lost update (cijeli red) |
| Signup Supabase | ✘ | ✘ | ✘ | ✘ | email confirmation, djelimični seed |
| Local/Supabase parity | ✘ | ✘ | — | ✘ | isti scenariji kroz oba adaptera |

## 3. Testovi koji nedostaju — po traženim temama

| Tema | Predloženi test | Sloj |
|---|---|---|
| Negative quantity | `atomic_checkout` sa `quantity: -1` i `0` → mora vratiti grešku, stock nepromijenjen | DB (pgTAP ili Vitest nad lokalnim Supabase-om) + unit za domain `validateCart` |
| Forged modifier price | `resolvedModifiers:[{modifierId:'x', optionId:'y', priceAdjustment:-100}]` → server ignoriše/odbija; cijena iz `menu_items.modifiers` | DB |
| Cross-tenant reads | anon i tenant B ne mogu `select` iz `orders`, `tables`, `receipts`, `employees`… tenant-a A | DB/RLS |
| Anon order access | anon `GET /orders` → 0 redova | DB/RLS |
| Station auth | `station_*` bez validnog station session-a → greška | DB |
| Station permissions | kitchen session → `cancelled` odbijen; service → dozvoljen | DB |
| Booking approval bypass | `submit_booking(p_status='approved')` uz `requireApproval=true` → upisano `pending` | DB |
| Closure injection | `submit_booking(p_type='closure')` → odbijeno | DB |
| Atomic checkout concurrency | 2 paralelne sesije za posljednji komad → tačno 1 uspjeh; stock = 0, ne < 0 | DB (paralelne konekcije) |
| Duplicate checkout | isti `idempotency_key` dva puta → jedna narudžba | DB + Menu component test (double click) |
| Partial unavailability | cart [A ok, B nedostupan] → A stock nepromijenjen | DB + local unit |
| Reservation expiry | fake timers: poslije 5 min rezervacija ne blokira | unit (postoji djelimično) |
| Business hours | tabela slučajeva: prije otvaranja, poslije zatvaranja, overnight, zatvoren dan, timezone | unit (domain/scheduling) |
| Scheduled order | server odbija prošlost / van radnog vremena / < now+30 | DB + unit |
| Realtime | onVisible merge ne gubi narudžbe (mock supabase) | unit |
| Local/Supabase parity | isti test suite nad `localAdapter` i `supabaseAdapter` (Phase 2) | integration |
| Hydration | AuthProvider local refresh zadržava svih 17 slice-ova | component/unit |
| OrderPortal | render + klik Takeaway + izbor slota → navigate URL | component |

## 4. Preduslovi
1. Dodati skriptu `typecheck` (`tsc -p tsconfig.app.json --noEmit`) i uključiti je u CI prije `build`.
2. Lokalni Supabase (`supabase start`) + migracije koje **stvarno reprodukuju produkciju** (05 §1) — bez toga DB testovi nemaju smisla.
3. Ukloniti/zamijeniti Playwright config (bez `lovable-agent-playwright-config`).
