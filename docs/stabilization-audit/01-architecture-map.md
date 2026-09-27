# 01 — Architecture map (stvarno stanje)

## 0. Kostur

```text
index.html → src/main.tsx → <App/> (src/App.tsx)
  QueryClientProvider   (React Query je mount-ovan, ali se NIGDJE ne koristi — nema useQuery/useMutation)
  AuthProvider          (src/components/providers/AuthProvider.tsx) — hidratacija store-a
  TooltipProvider, Toaster (shadcn) + Sonner
  BrowserRouter + Suspense(PageLoader) + lazy() stranice
```

Mod rada se bira **u runtime-u, globalno**: `isSupabaseEnabled()` (`src/store/flags.ts`) = `VITE_SUPABASE_URL` postoji. Izuzetak: demo login je uvijek local, čak i kad je Supabase uključen (03 §3.8).

## 1. Routing (`src/App.tsx`)

| Route | Komponenta | Auth | Napomena |
|---|---|---|---|
| `/` | Login | public | |
| `/signup` | Signup | public | |
| `/menu` | customer/Menu | public | `?t` dine-in, `?mode=takeaway|delivery&date&time&addr`, `?r` token |
| `/receipt/:receiptId` | customer/Receipt | public | |
| `/track` | customer/OrderTracker | public | `?r&n`; **nije linkovan nigdje u aplikaciji**; nije u CLAUDE.md |
| `/dashboard` … `/calendar` (11 ruta) | admin/* | `AdminGuard` | Guard čeka `_hasHydrated`, pa provjerava `isAuthenticated` (client-only) |
| `/book/:restaurantToken` | customer/BookingPage | public | |
| `/order/:restaurantToken` | customer/OrderPortal | public | samo takeaway/delivery |
| `/roster/:restaurantToken` | customer/RosterPage | public | nije u CLAUDE.md |
| `/station/:restaurantToken/:stationId` | station/StationGate | public, PIN (client) | nije u CLAUDE.md |
| `*` | NotFound | | |

## 2. Auth

```text
Login.tsx → store.login(email, pw)
  demo@smartline.io/demo1234 → UVIJEK local (smartline-auth + smartline-workspace-user-demo)
  Supabase → supabase.auth.signInWithPassword → loadWorkspaceFromSupabase (hydration.ts) → set(...)
             → autoMigrations.runBackgroundMigrations (backfill local→cloud, base64→Storage)
  Local    → smartline-accounts (plaintext lozinke) → loadWorkspaceStateLocal
Refresh → AuthProvider
  Supabase → auth.getSession() → loadWorkspaceFromSupabase → setState (BEZ top-level stations)
             onAuthStateChange(SIGNED_OUT) → djelimičan reset
  Local    → _rehydrateLocal() (NEKOMPLETNO — 8 slice-ova)
Signup → store.signup → Supabase auth.signUp + seed settings/menu/tables  |  local accounts
AdminGuard → client-only provjera; stvarna zaštita podataka = RLS
```
Role: `User.role` je uvijek `'admin'`; `manager` se nigdje ne dodjeljuje.

## 3. Zustand store
Jedan store (`src/store/index.ts`) sa 17 data slice-ova + oko 60 akcija. Nema `persist` middleware-a (CLAUDE.md pogrešno pominje ključ `smartline-v1`). Perzistencija je ručna (`_persistLocal`). Detalji u `03-store-audit.md`.

## 4. localStorage fallback — ključevi

| Ključ | Sadržaj | Ko piše |
|---|---|---|
| `smartline-auth` | `{user, isAuthenticated}` | store.login/signup, AuthProvider čita |
| `smartline-workspace-{userId}` | cijeli workspace snapshot `{state, version:1}` | `_persistLocal`, `addCalendarEvent` (surgical) |
| `smartline-accounts` | `[{email, password, user}]` | signup (local) |
| `smartline-device` | stabilni deviceId | customerSession |
| `smartline-customer-{token}` | korpa + placedOrderIds (TTL) | Menu |
| `sl-station-{stationId}` | `{expiresAt}` sesija stanice | StationGate |
| sessionStorage `smartline-migrations-ran-v1` | guard | autoMigrations |

Cross-tab sync: `window.storage` listener (`store/index.ts:1449-1473`) — kod nehidratisanih (public) tabova patch-uje samo `calendarEvents` i `orders`.
Retencija: orders/receipts/kitchenEvents stariji od 90 dana se odbacuju pri učitavanju (`store/index.ts:107-132`).

## 5. Supabase hydration
`loadWorkspaceFromSupabase` (`store/hydration.ts:48`) — 16 paralelnih upita (svi `select('*') … eq(user_id)`, **bez limita**: sve narudžbe i računi svih vremena). Ako nema settings reda → kreira ga sa novim tokenom. `calendarSettings` fallback nema `shiftTemplates/weekTemplate`.

## 6. Optimistic writes / bridge
`src/store/bridge.ts` (~20 `persist*` funkcija) → `src/lib/supabase/queries/*.ts` (PostgREST CRUD) → tabele. Nema retry-a ni reda; greška = toast (+ ponekad rollback). Settings i calendar_settings se pišu kao **cijeli** objekat.

## 7. Realtime

| Hook | Ko | Kanal / tabele | Radi? |
|---|---|---|---|
| `useRealtimeCoordinator` (`DashboardLayout.tsx:33`) | admin (authenticated) | `admin:{uid}`: orders INSERT/UPDATE, kitchen_events INSERT, menu_items UPDATE, calendar_events INSERT/UPDATE; + visibilitychange refetch | ✔ (calendar_events publikacija je DRIFT) |
| `useMenuSubscription` (Menu) | kupac (anon) | `menu:{uid}`: menu_items UPDATE | **✘** — anon nema SELECT policy na `menu_items` od 009 |
| `useStationOrders` (stanice) | anon | `station:{token}`: orders INSERT/UPDATE, tables UPDATE → refetch preko RPC-a; poll 30 s | ✔ samo zbog anon `USING(true)` policy-ja (SEC-01) |

Admin **ne sluša** `tables` (promjene statusa stola sa drugih uređaja se ne vide do refresh-a) ni `stock_reservations`.

## 8. Podsistemi: UI → state/action → query/RPC → tabela → povratak

Oznake: **[L]** local mode, **[S]** Supabase mode, **≠** ponašanje se razlikuje.

### Customer ordering
```text
OrderPortal / Menu / Receipt
→ Menu local state (cart) + store.validateCart/createReservation/checkout
→ [S] RPC get_customer_menu (učitavanje), RPC atomic_checkout (plaćanje)   [L] store data (samo isti browser kao admin)
→ business_settings, menu_items, tables, orders, receipts, stock_reservations
→ [S] admin: realtime orders INSERT; kupac: nema realtime-a (useMenuSubscription ne radi)   [L] storage event
≠ pause, parcijalni stock leak, modifier cijene, reservations (08 §3)
```

### Booking
```text
BookingPage → (lokalni state) → [L] store.addCalendarEvent  [S] RPC get_booking_data / submit_booking
→ calendar_events (+ event_packages, business_settings.calendar_settings)
→ admin realtime calendar_events INSERT; kupac bez povratnog kanala (osim [L] storage event)
≠ phone lookup (radi samo [L])
```

### Roster
```text
RosterPage → [S] RPC get_roster_data  [L] store.employees/shifts (isti browser)
→ employees, shifts → nema realtime-a
Admin: Calendar.tsx → store.addEmployee/addShift/applyWeekTemplate… → bridge → employees, shifts
```

### Stations
```text
StationGate → RPC get_customer_menu (settings.stations sa PIN-om) → client PIN → localStorage sesija
→ Kitchen/Bar/ServiceStation → useStationOrders
→ [S] RPC station_get_orders/advance/adjust/log (DRIFT funkcije)  [L] store akcije
→ orders, kitchen_events; tables (samo [L])
→ [S] realtime orders/tables (anon) + poll   [L] zustand
≠ cancel (stock), remake (smjer), table status (perzistencija), prep clamp
```

### Admin
```text
admin/* stranice → useStore(useShallow) + store akcije → bridge → queries → sve tabele (owner RLS)
Povratak: useRealtimeCoordinator; ostalo samo refresh
```

### Checkout
```text
Menu.handlePayment → store.checkout
  [S] resolvedModifiers se računaju na klijentu → RPC atomic_checkout (lock settings FOR UPDATE, lock menu_items FOR UPDATE,
      purge expired reservations, insert orders + receipts, next_order_number++, tables.status) → set(order, receipt, stock, table)
  [L] _localCheckout (sinhrono, više set-ova)
```

### Receipts
```text
Receipt.tsx → store.receipts || [S] RPC get_receipt_by_id(uuid) → receipts
Admin: hydration fetchReceipts (sve, bez limita), ali nijedna admin stranica/komponenta ne čita `receipts` (grep) → učitavanje bez upotrebe
```

### Inventory
```text
Inventory.tsx → store.adjustStock / setStock / restockItem → bridge persistMenuItemUpdate({stock: apsolutno}) → menu_items.stock
Ingredients.tsx → store.add/update/deleteIngredient → ingredients (DRIFT tabela)
MenuManager → recipe/costPerServing na menu_items; slike → Storage bucket menu-images (uploadMenuImage)
Povratak: realtime menu_items UPDATE (admin)
Stock konzumira: atomic_checkout (samo menu_items.stock; ingredients.stock se NE umanjuje pri prodaji)
```

### Calendar / shifts
```text
Calendar.tsx (1940 linija) → store calendar/eventPackage/employee/shift/calendarSettings akcije
→ bridge → calendar_events, event_packages, employees, shifts, business_settings.calendar_settings
→ realtime samo calendar_events
```

## 9. Dva puta (local vs Supabase) — gdje se razlikuju
Zbirno u `03-store-audit.md §3.7` i `08-ordering-audit.md §3`. Ključno: **svi automatski testovi pokrivaju samo local put**, a produkcija koristi Supabase put.
