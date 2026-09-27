# 11 — Tech debt, dead code, inconsistencies, file size

## 1. Dead / nekorišćen kod (CONFIRMED grep-om)

| Stavka | Lokacija | Napomena |
|---|---|---|
| `src/App.css` | — | Nije importovan (`main.tsx` importuje samo `index.css`) |
| `src/components/NavLink.tsx` | — | Nigdje importovan |
| `src/hooks/use-mobile.tsx` | — | Nigdje importovan |
| `src/test/example.test.ts` | — | `expect(true)` placeholder |
| React Query (`QueryClientProvider`) | `App.tsx` | Nema nijednog `useQuery`/`useMutation` |
| `store.reorderMenuItems` | `store/index.ts:487` | Nema poziva |
| `store.getActiveOrders`, `store.getTodayOrders` | `:1043`, `:1047` | Nema poziva; UI duplira logiku |
| `customerSession.clearSession` | `lib/customerSession.ts` | Koristi se samo u testovima |
| `storage.deleteMenuImage` | `lib/supabase/storage.ts:157` | Nema poziva → slike obrisanih artikala ostaju u bucket-u |
| `receipts` slice | store + hydration | Učitava se, ali ga nijedna admin stranica ne koristi |
| `shifts.employee_ids`, `shifts.role` kolone | DB | Legacy poslije 003 |
| 23 shadcn komponente bez upotrebe van `ui/` | `src/components/ui/`: alert, badge, card, chart, checkbox, command, drawer, dropdown-menu, form, popover, progress, radio-group, scroll-area, select, separator, sheet, skeleton, slider, table, tabs, textarea, toggle-group, toggle | Grep ne nalazi import van `ui/`. Nisko prioritetno; tree-shaking ih izbacuje iz bundle-a. |
| Playwright config + fixture | root | Paket ne postoji (02 §4) |
| `bun.lock`, `bun.lockb` | root | Zastarjeli (02 §5) |
| `/track` ruta (OrderTracker) | `App.tsx` | Funkcionalna, ali nije linkovana nigdje u UI-ju |
| `PROJECT_NOTES.md` "Git log" | — | Repo nema `.git` |

## 2. Unreachable / pokvarene grane
- `OrderPortal.tsx:209` — `noSlotsToday` (runtime crash, 02 §3.1).
- `Menu.tsx:436-439` — "Dine In" u ModeSelectorScreen vodi na `/order/:token`, koji nema dine-in → petlja.
- `BookingPage.tsx:52` — grana `status === 'declined'` se nikad ne izvršava (domen koristi `rejected`).
- `store.login` local fallback (`:330-333`) — ponovna provjera demo kredencijala je nedostižna (demo je već obrađen na `:286`).
- `AuthProvider` `_rehydrateLocal` — grana se izvršava samo kad Supabase nije uključen; demo u Supabase modu je ne dobija.

## 3. Zastarjeli komentari i dokumentacija

| Gdje | Tvrdnja | Stvarnost |
|---|---|---|
| `CLAUDE.md` Stack | "Zustand (store + localStorage persistence under key `smartline-v1`)" | Ključevi su `smartline-auth`, `smartline-workspace-{id}`…; nema `persist` middleware-a |
| `CLAUDE.md` Routes/Flows | "`/order/:token` → pick table" (dine-in) | OrderPortal nema table picker |
| `CLAUDE.md` Routes | nema `/track`, `/roster`, `/station` | postoje |
| `CLAUDE.md` Supabase RPCs | 3 RPC-a | frontend koristi 11 |
| `CLAUDE.md` Store Conventions | "Table status only updated when tableId matches UUID regex" | tačno samo za Supabase granu; local koristi `tables.find` |
| `CLAUDE.md` Current State | "All three ordering channels functional end-to-end" | Takeaway/delivery padaju (noSlotsToday); dine-in samo preko QR-a |
| `CLAUDE.md` / migracije | "apply via Supabase MCP `apply_migration`" + sekvencijalno | Remote istorija ima 16 nevezionisanih migracija (05 §1) |
| `PROJECT_NOTES.md` Known issues | Structured hours i scheduled_for su "High/Medium" otvoreni | Urađeni u 013 |
| `README.md` | "Welcome to your Lovable project / TODO" | — |
| `014` komentar | anon policy "just unblocks the realtime channel trigger" | otvara i REST (SEC-01) |
| `009` header | "After this migration, no anon caller can read another tenant's rows" | Poništeno migracijom 014 |
| `useMenuSubscription.ts:9-10` | "RLS policy allows public reads of active items" | Policy dropovana u 009 |
| `010` + `queries/settings.ts` | "categories JSONB column" | `text[]` |
| `receipts.ts` komentar | receipt UUID "never leaves the customer's session/URL" | Nalazi se u URL-u (dijeli se, loguje) |
| `useStationOrders.ts:12-14` | "Stations work fully in demo mode" | Samo u browseru gdje je admin ulogovan |
| `OrderPortal.tsx:1-10` | ispravno opisuje takeaway/delivery | ✔ (ali suprotno CLAUDE.md) |

## 4. Duplirani helperi i konstante

| Šta | Kopije |
|---|---|
| "Danas" kao string | `OrderPortal.todayStr`, `Menu` (3×), `Receipt.fmtScheduled`, `BookingPage.today/isoDate`, `Calendar.today/isoDate`, `DashboardLayout`, `Orders.formatScheduledFor` (UTC) vs `Orders.dayKey/formatDayLabel` (lokalno) |
| Format scheduled labela | `Menu.formatScheduledLabel`, `Receipt.fmtScheduled`, `Orders.formatScheduledFor` |
| Slot generator | `OrderPortal.getAvailableTimeSlots`, `Menu.getSchedulingSlots`, `BookingPage.buildTimeSlots` |
| Default CalendarSettings / working days | `store/index.ts:29-48`, `hydration.ts:86-101`, `BookingPage.tsx:151-164`, `Settings.tsx` `DEFAULT_BUSINESS_HOURS` |
| `StatusBadge` | `Calendar.tsx:97`, `BookingPage.tsx:46` (različite vrijednosti) |
| `Modal` | `Calendar.tsx:76` + shadcn Dialog |
| UUID regex | `store/index.ts:1016` + SQL 012/013 |
| Keyword → ime (`Takeaway`, `Delivery`, `Walk-in`) | `store MODE_NAMES` + SQL `CASE` + `Menu MODE_META` |
| `ACTIVE_STATUSES` | `Orders.tsx`, `useRealtimeCoordinator.ts:30`, `useStationOrders.ts:23`, `stations.ts:3`, `orderMachine.isActiveOrder`, `DashboardLayout` inline |
| Pricing (line total, tax, prep) | `Menu.tsx`, `_localCheckout`, SQL |
| `AUTH_KEY`, `WORKSPACE_KEY` | `store/index.ts:96-97`, `AuthProvider.tsx:14-15` |
| Workspace rehydrate | `loadWorkspaceStateLocal` (store), `_rehydrateLocal` (AuthProvider) — druga je nekompletna |
| Payment labele | `Menu.PAYMENT_METHODS` ("Pay on Pickup"), `Receipt.PAYMENT_LABELS` ("Pay at Counter") |
| Customer menu bootstrap (`fetchRestaurantByToken` + `setState`) | Menu, StationGate, OrderPortal, BookingPage (svaki drugačije) |

## 5. Mixed terminology / naming
- `reservation` znači dvije stvari: **stock reservation** (`StockReservation`, `stock_reservations`) i **table booking** (`CalendarEvent.type='reservation'`).
- `session`: customer session (localStorage korpa), stock `sessionId` (random po učitavanju), station session (PIN).
- `tableId` nosi i UUID i keyword-e (`takeaway`, `delivery`, `walk-in`); `table_name` je slobodan tekst.
- `openingHours` (string) vs `businessHours` (strukturisano) vs `calendarSettings.workingDays` (booking) — tri koncepta radnog vremena bez veze.
- `declined` vs `rejected`.
- `served` status samo u DB-u.
- `categories`: store `string[]`, DB `text[]`, komentari "JSONB".
- Dokumentacija na engleskom, korisnik komunicira na srpskom — OK, ali UI copy je hardkodovan (nema i18n, iako postoji `settings.language`, koji se ne koristi).

## 6. Local-only funkcionalnost predstavljena kao produkciona
- Local accounts / signup (plaintext lozinke).
- Demo nalog u Supabase deploymentu (03 §3.8).
- Stanice u local modu (samo isti browser).
- Booking/roster/portal u local modu (samo isti browser kao admin).
- Cross-tab sync preko `storage` eventa.

## 7. Supabase-only funkcionalnost bez local ekvivalenta
- Order tracker (`/track` — `supabase` null → greška).
- Receipt fetch sa drugog uređaja.
- Base64 → Storage migracija, slike u bucket-u.
- `atomic_checkout` pause check (local ga nema).
- Server-side zaključavanje (concurrency) — local nema pojam više uređaja.

## 8. Najveći source fajlovi (linije)

| Fajl | Linije | Odgovornosti |
|---|---|---|
| `src/pages/admin/Calendar.tsx` | 1940 | kalendar mjeseca/sedmice, eventi, paketi, zaposleni, smjene, šabloni smjena, week template editor, assign panel, work log, linkovi — **9 pod-komponenti + stranica** |
| `src/pages/admin/Tables.tsx` | 1732 | floor map editor (drag/resize/rotate, grid), dekoracije, zone, spratovi, QR generisanje/download, inspector, forme — **12 pod-komponenti** |
| `src/pages/customer/Menu.tsx` | 1539 | bootstrap podataka, mode selector, scheduling fallback, katalog, item sheet, korpa, payment, session orders, pricing |
| `src/store/index.ts` | 1499 | auth, 12 domena, local persistence, cross-tab sync, local checkout |
| `src/pages/admin/MenuManager.tsx` | 1167 | lista, forma artikla, recept/jedinice, modifier editor, upload slika |
| `src/pages/admin/Orders.tsx` | 786 | grupisanje po danu/stolu, carryover, kitchen event modal |
| `src/pages/customer/BookingPage.tsx` | 720 | load, dostupnost, slotovi, forma, lookup |
| `src/pages/admin/Stations.tsx` | 705 | CRUD stanica, permission editor, QR |
| `src/pages/admin/Analytics.tsx` | 656 | 5+ agregacija u komponenti |
| `src/pages/station/KitchenStation.tsx` | 588 | production summary, prep bar, event panel, kartica |

## 9. Dependency coupling
- 28 fajlova importuje `@/store`; store je jedini "service layer".
- 13 UI fajlova importuje `lib/supabase/*` direktno (zaobilaze store, suprotno CLAUDE.md "never bypass the store"): `DashboardLayout`, `AuthProvider`, `MenuManager` (storage), `BookingPage`, `Menu`, `OrderPortal`, `OrderTracker`, `Receipt`, `RosterPage`, 3 station stranice, `StationGate`.
- 8 mjesta van akcija piše direktno `useStore.setState` (AuthProvider, 3 realtime hook-a, Menu, StationGate, autoMigrations, testovi) → nema centralne kontrole invarijanti.
- Kružna zavisnost: `store/index.ts` → dinamički `import('./hydration')`, `import('./autoMigrations')`; `autoMigrations.ts` → statički `import { useStore } from './index'`. Radi zbog dinamičkog importa, ali je krhko.
- `store/index.ts` statički importuje `bridge.ts`, koji importuje sve `queries/*` → Supabase client je u glavnom bundle-u i za local mode.

## 10. Prijedlog podjele (bez refaktora sada)

| Fajl | Predložene granice |
|---|---|
| `Calendar.tsx` | `calendar/CalendarPage` (shell + tabovi), `calendar/events/*` (EventForm, lista, approve/reject), `calendar/packages/*`, `staff/employees/*`, `staff/shifts/*` (ShiftForm, AssignPanel, WeekTemplateEditor, ShiftTemplateForm), `staff/WorkLog`, `calendar/lib/dates.ts` |
| `Tables.tsx` | `floor/editor/*` (canvas, drag/resize hook, grid utils), `floor/decorations/*`, `floor/inspector/*`, `floor/zones/*`, `floor/qr/*`; posebno postoji `FloorMapCanvas.tsx` — spojiti, jer je sad dvojni renderer |
| `Menu.tsx` | `customer/menu/useCustomerMenuData` (bootstrap), `useCart` (+ pricing iz domain-a), `ModeSelector`, `SchedulingStep` (dijeljeno sa OrderPortal), `CatalogGrid`, `ItemSheet`, `CartSheet`, `PaymentSheet`, `SessionOrdersSheet` |
| `store/index.ts` | slice-ovi iz 03 §4 + `services/` + `persistence/` adapteri |
| `MenuManager.tsx` | `MenuItemForm`, `RecipeEditor` (+ unit konverzije u domain), `ModifierGroupEditor`, `ImageUpload` |
| `Orders.tsx` | `useOrderBuckets` (carryover/today/older — domain), `TableOrderGroup`, `KitchenEventModal` |
| `BookingPage.tsx` | `domain/booking/availability.ts`, `useBookingData`, koraci kao komponente |
