# 03 — Store audit (`src/store/index.ts`, 1499 linija)

## 1. Obrazac svake akcije

```text
set(optimistic) → _persistLocal(get)            (no-op kad je Supabase uključen ili nema _activeUserId)
               → if (isSupabaseEnabled() && user?.id) bridge.persistX(...).catch(rollback? + toast)
```
- `_persistLocal` (`:1437`) serijalizuje **cijeli** workspace snapshot (17 slice-ova) u `smartline-workspace-{userId}` pri svakoj akciji.
- Bridge (`src/store/bridge.ts`) je write-through bez retry-a, bez reda (queue) i bez verzionisanja. Većina grešaka se samo prikaže kao toast.
- **Nema nijedne transakcije preko više entiteta na klijentskoj strani.** Atomičan je samo Supabase `checkout` (RPC).

## 2. Tabela akcija

Legenda — Local persistence: ✔ `_persistLocal`. Supabase write: bridge funkcija; `[u]` = samo ako postoji `user.id`; `[!u]` = poziva se i bez korisnika. Rollback: F = puni rollback prethodne vrijednosti, — = nema, P = djelimičan. Atomic: da li su sve promjene jedne akcije jedna jedinica.

| Action | Čita | Mijenja Zustand | Local | Supabase write | Rollback | Atomic |
|---|---|---|---|---|---|---|
| `login` (`:284`) | localStorage / Supabase auth + cijeli workspace | sve | auth key | — (čita) | — | n/a |
| `logout` (`:348`) | — | resetuje dio slice-ova (**ne** calendarEvents, eventPackages, calendarSettings, employees, shifts) | briše auth | `signOut` | — | — |
| `signup` (`:364`) | accounts | sve | accounts + auth | `upsertSettings` + insert menu/tables (sekvencijalno, bez rollback-a; poluupisan tenant pri grešci) | — | ✘ |
| `addMenuItem` | menuItems | menuItems | ✔ | `persistNewMenuItem` [u] | — (ostaje lokalno) | — |
| `updateMenuItem` | menuItems | menuItems | ✔ | `persistMenuItemUpdate` [u] | F (vraća `prev` — i prepisuje izmjene u međuvremenu) | — |
| `deleteMenuItem` (soft, archived) | menuItems | menuItems | ✔ | `persistMenuItemUpdate` [u] | F | — |
| `setMenuItemStatus` | menuItems | menuItems | ✔ | isto | F | — |
| `reorderMenuItems` (**nekorišćena**) | — | menuItems | ✔ | `persistMenuItemReorder` [!u] | — | ✘ |
| `addCategory` / `deleteCategory` | categories | categories | ✔ | `saveCategories` (dinamički import) [u] | — | — |
| `addTable` | — | tables | ✔ | `persistNewTable` [u] | — | — |
| `updateTable` | tables | tables | ✔ | `persistTableUpdate` [u] | F | — |
| `deleteTable` | tables | tables | ✔ | `persistDeleteTable` [u] | F (append na kraj) | — |
| `setTableStatus` | tables | tables | ✔ | `persistTableUpdate` [u] | F | — |
| `addDecoration` | — | decorations | ✔ | [u] | — | — |
| `updateDecoration` | — | decorations | ✔ | [u] | — | — |
| `deleteDecoration` | decorations | decorations | ✔ | [u] | F | — |
| `adjustStock` (`:626`) | menuItems (poslije set-a) | menuItems | ✔ | `persistMenuItemUpdate({stock: APSOLUTNA vrijednost})` [u] | — | ✘ lost update |
| `setStock` | — | menuItems | ✔ | apsolutna [u] | — | — |
| `restockItem` | menuItems | menuItems | ✔ | apsolutna [u] | — | — |
| `advanceOrderStatus` (`:669`) | orders | orders | ✔ | `persistOrderUpdate({status})` [u] | F | ✘ (nema expected-status provjere) |
| `cancelOrder` (`:689`) | orders, menuItems, tables | menuItems (N× `set` kroz `_restoreStock`), orders, tables (kroz `setTableStatus`) | ✔ | **samo** `{status:'cancelled'}` [u] + `setTableStatus` bridge. **Vraćeni stock se NE upisuje u Supabase.** | — | ✘ |
| `refundOrder` | orders | orders (samo iz `cancelled`) | ✔ | [u] | F | — |
| `adjustPrepTime` | orders | orders (clamp -60..180) | ✔ | [u] | — | — |
| `updateSettings` (`:830`) | settings | settings | ✔ | `persistSettings` = **upsert CIJELOG reda** (uklj. `stations`, `restaurant_token`) [u] | — | ✘ lost update |
| `addIngredient` / `updateIngredient` / `deleteIngredient` | — | ingredients | ✔ | [u] / [u] / [u] | — | — |
| `logKitchenEvent` | — | kitchenEvents (cap 500) | ✔ | [u] best-effort, greška se guta | — | — |
| `addStation` / `updateStation` / `deleteStation` | **top-level `stations`** | stations + settings.stations | ✔ | `persistSettings` (cijeli red) [u] | — | ✘ (vidi BUG-04) |
| `validateCart` | menuItems, settings, reservations | — | — | — | — | čisto |
| `createReservation` (`:877`) | menuItems, reservations (više `get()`) | reservations (3× `set`) | ✔ | `persistNewReservation` [u] — **kupac nema user → nikad** | — | ✘ |
| `releaseReservation` | — | reservations | ✔ | [u] | — | — |
| `checkout` Supabase (`:919`) | settings, menuItems | orders, receipts, nextOrderNumber, menuItems, tables (1 `set`) | — | RPC `atomic_checkout` (server-atomic) | n/a (piše se tek poslije uspjeha) | ✔ server / ✔ client |
| `checkout` Local (`_localCheckout :1307`) | menuItems, tables, settings, reservations | reservations, menuItems (N× `set`), orders+receipts, tables, reservations | ✔ | — | — | ✘ (međustanja vidljiva listenerima) |
| `getAvailableStock` / `getActiveOrders`* / `getTodayOrders`* | — | — | — | — | — | *nekorišćene |
| `addCalendarEvent` | _hasHydrated | calendarEvents | ✔ ili surgical localStorage write | [u] | — | — |
| `updateCalendarEvent` / `deleteCalendarEvent` / `approve…` / `reject…` | — | calendarEvents | ✔ | [!u] | — | — |
| `addEventPackage` | — | eventPackages | ✔ | [u] | — | — |
| `updateEventPackage` / `deleteEventPackage` | — | eventPackages | ✔ | [!u] | — | — |
| `updateCalendarSettings` / `updateWeekTemplate` | calendarSettings | calendarSettings | ✔ | cijeli jsonb [u] | — | ✘ lost update |
| `addEmployee` | — | employees | ✔ | [u] | — | — |
| `updateEmployee` | — | employees | ✔ | [!u] | — | — |
| `deleteEmployee` (`:1200`) | — | employees + **shifts.assignments** | ✔ | **samo** `persistDeleteEmployee`; izmjene smjena se ne upisuju | — | ✘ |
| `addShift` / `updateShift` / `deleteShift` | — | shifts | ✔ | [u] / [!u] / [!u] | — | — |
| `applyWeekTemplate` (`:1248`) | calendarSettings, shifts | shifts (batch) | ✔ | N× `persistNewShift` paralelno, bez rollback-a | — | ✘ |

## 3. Specifični problemi

### 3.1 Business logika u UI komponentama (pripada store-u/domenu)
| Logika | Gdje | Duplikat / problem |
|---|---|---|
| Cijena korpe, modifier suma, porez, total | `Menu.tsx:222-280` | Duplira `_localCheckout` (`store:1339-1382`) i SQL `atomic_checkout` |
| Procjena čekanja (`maxPrep + (n-1)*2`) | `Menu.tsx:283-289` | Duplira store `:1383-1387` i SQL |
| Generisanje notes-a sa kontaktima | `Menu.tsx:361-373` | Treba strukturisana polja |
| Slot generator | `OrderPortal.tsx:72-104`, `Menu.tsx:64-80` | Dvije verzije, jedna ignoriše radno vrijeme |
| Open/closed provjera | `OrderPortal.tsx:45-66` | Samo ovdje; Menu ne provjerava |
| "Today orders" / revenue | `Dashboard.tsx:106,137`, `DashboardLayout.tsx:52-56`, `Orders.tsx:94-114` | Store ima nekorišćeni `getTodayOrders`; tri različite definicije "danas" (lokalno vs UTC) |
| Carryover / grupisanje po danu | `Orders.tsx:94-120` | — |
| Oslobađanje stola po završetku | `ServiceStation.tsx:125-138`, `Orders.tsx` (clear) | Pravilo "sto slobodan kad su sve narudžbe terminalne" nije u domenu |
| Booking dostupnost / slotovi / status odluka | `BookingPage.tsx:200-253` | Ne postoji u store-u; server ne validira |
| Station remake / cancel semantika | `useStationOrders.ts:98-141, 213-224` | Dvije različite semantike (07 ST-06) |
| Hydration + seed default-i | `AuthProvider.tsx:96-169` | Duplira `loadWorkspaceStateLocal` (`store:109-146`) nekompletno |
| Default CalendarSettings | store, hydration, BookingPage | 3 kopije |

### 3.2 Akcije koje mijenjaju više entiteta bez atomske zaštite
- `cancelOrder`: stock (N set-ova) + order + table; u Supabase modu upisuje se samo status narudžbe i sto, a **stock ostaje neusklađen sa DB-om**. Poslije refresh-a admin vidi stari (umanjeni) stock. CONFIRMED statički.
- `deleteEmployee`: employees + shifts.assignments; DB zadržava reference na obrisanog zaposlenog u `shifts.assignments`.
- `signup` (Supabase): settings, menu, tables sekvencijalno; greška u sredini ostavlja poluinicijalizovan tenant (hydration kasnije kreira settings ako fale).
- `applyWeekTemplate`: N nezavisnih insert-a.
- `_localCheckout`: više `set` poziva.
- `addStation` / `updateStation` / `deleteStation`: stations + cijeli settings red.

### 3.3 Optimistic update bez rollback-a
`addMenuItem`, `addTable`, `addDecoration`, `updateDecoration`, `adjustStock`, `setStock`, `restockItem`, `cancelOrder`, `adjustPrepTime`, `updateSettings`, sve ingredient/station/calendar/employee/shift akcije, `addCategory`/`deleteCategory`. Pri grešci lokalno stanje ostaje "uspješno", a DB nije promijenjen, dok se ne uradi refresh.

### 3.4 Djelimični / štetni rollback
- Rollback vraća cijeli `prev` objekat (`updateMenuItem`, `updateTable`, `advanceOrderStatus` …). Ako je u međuvremenu stigao realtime update ili druga lokalna izmjena, rollback je **prepisuje**.
- `deleteTable` rollback dodaje sto na kraj niza (redoslijed se mijenja).
- `advanceOrderStatus` rollback ne vraća `updatedAt` konzistentno sa DB-om.

### 3.5 Async race conditions / stale state / write-after-read
| # | Scenario | Status |
|---|---|---|
| R1 | `adjustStock` šalje **apsolutnu** vrijednost izračunatu iz lokalnog stanja. Kupac kupi u međuvremenu (server umanji stock) → admin write prepiše serverski decrement → stock "vaskrsne". Isto za `setStock`/`restockItem` (tu je apsolutno namjerno, ali bez provjere verzije). | CONFIRMED statički |
| R2 | `advanceOrderStatus` računa `next` iz lokalnog statusa. Stanica je već pomjerila narudžbu → admin klik šalje status koji može biti **unazad** (npr. lokalno `paid→preparing`, a DB je već `ready`). Nema `WHERE status = expected`. | CONFIRMED statički |
| R3 | `updateSettings` / station akcije upsert-uju cijeli red iz lokalnog snapshot-a → izmjene sa drugog uređaja/taba se gube. `Settings.tsx` drži form snapshot od mount-a (`:29-61`) i `updateSettings(form)` prepisuje i `stations`. | CONFIRMED statički |
| R4 | `useRealtimeCoordinator.onVisible` (`:132-150`) zamjenjuje sve aktivne narudžbe svježim spiskom (limit 100), a "historical" zadržava samo ne-aktivne **iz lokalnog stanja** → narudžba koja je postala `completed` dok je tab bio skriven **nestaje iz store-a** do full refresh-a. Više od 100 aktivnih → višak nestaje. | CONFIRMED statički |
| R5 | `checkout` Supabase poslije uspjeha radi optimistic stock decrement lokalno; realtime `menu_items` UPDATE zatim postavlja apsolutnu vrijednost → OK, ali ako realtime stigne prije lokalnog set-a → dupli decrement u UI-ju do sljedećeg eventa. | PLAUSIBLE |
| R6 | `AuthProvider` Supabase init i `login()` oba pokreću `runBackgroundMigrations`; guard `_inFlight` + sessionStorage ključ štiti. | OK |
| R7 | `StationGate` upisuje tenant podatke u globalni store (07 ST-13). | PLAUSIBLE |

### 3.6 Višestruki `get()` sa mogućom nekonzistentnošću
- `createReservation`: `get().menuItems` snapshot na početku, pa `get().getAvailableStock` u petlji (svaki put novi `get()`), pa `get().releaseReservation`, pa `set`. U single-threaded JS-u nema interleaving-a, ali `releaseReservation` poziva `_persistLocal` i bridge **prije** nego što je nova rezervacija dodata → persistirano međustanje.
- `_localCheckout`: `menuItems` iz početnog snapshot-a služi za cijene, a `get().reservations` se čita u petlji. Stock se oduzima kroz `set(s => …)` nad svježim stanjem → konzistentno. Rizik je nizak.
- `adjustStock` / `restockItem`: `get()` poslije `set` za vrijednost koja se šalje → OK, ali vidi R1.
- `cancelOrder`: `get().tables.find` poslije `_restoreStock` pa `get().setTableStatus` (nova akcija sa sopstvenim persist-om i bridge-om).

### 3.7 Local vs Supabase implementacije rade različite stvari
| Akcija | Local | Supabase |
|---|---|---|
| Checkout | provjerava sve pa oduzima; ignoriše pause | oduzima u petlji (leak); poštuje pause |
| cancelOrder | stock vraćen i perzistiran | stock vraćen samo u memoriji |
| Station cancel | `cancelOrder` (stock + sto) | samo status |
| Station remake | advance naprijed | `preparing` |
| Reservation | u localStorage (vidljiva drugim tabovima) | kupac: samo u memoriji taba |
| Table status sa stanice | perzistira | ne perzistira |
| Refresh hydration | `_rehydrateLocal` — nekompletno (BUG-03) | `loadWorkspaceFromSupabase` — kompletno, ali bez top-level `stations` (BUG-04) |
| Demo login | local | **i dalje local**, dok bridge-ovi pucaju (vidi 3.8) |

### 3.8 Demo nalog u Supabase deploymentu — CONFIRMED statički
`login()` za demo uvijek ide lokalnom putanjom (`:286-292`), ali `isSupabaseEnabled()` je true, pa:
- `_persistLocal` je no-op (`:1438`) → **demo izmjene se nigdje ne čuvaju**;
- svaka akcija sa `user.id = 'user-demo'` zove bridge: INSERT pada (nevalidan UUID / RLS) → toast greške; UPDATE po id-ju bez auth sesije pogađa 0 redova → tiho "uspijeva";
- refresh: `AuthProvider` u Supabase modu ne čita `smartline-auth` → demo korisnik je odjavljen.

### 3.9 Hydration nekompletnost
- **BUG-03 (local)**: `_rehydrateLocal` (`AuthProvider.tsx:96-169`) ne vraća `ingredients, kitchenEvents, decorations, calendarEvents, eventPackages, calendarSettings, employees, shifts` niti top-level `stations` → prva akcija briše te podatke iz localStorage. **Runtime reprodukovano** (02 §3.2).
- **BUG-04 (Supabase)**: `AuthProvider.tsx:54` radi `setState({...workspace})` bez `stations: workspace.settings.stations` (za razliku od `login()`, `:317`) → poslije refresh-a Stations stranica je prazna; `addStation` radi `[...[], new]` i upisuje u DB → **briše sve postojeće stanice**.
- `SIGNED_OUT` handler (`AuthProvider.tsx:70-78`) resetuje manje slice-ova nego `logout()`.

## 4. Prijedlog granica modula (bez refaktora sada)

```text
src/domain/
  ordering/   pricing.ts (line total, modifiers, tax, prep estimate) — čiste funkcije, dijele ih Menu, store i test
              orderMachine.ts (postoji) + canCancel/canRefund
              scheduling.ts (slots, open/closed, timezone-aware "today")
  booking/    availability.ts, validation.ts
  stations/   permissions.ts (postoji stations.ts)
src/services/            (jedini sloj koji zna za local vs Supabase)
  orderService.ts        checkout, advance(expectedStatus), cancel (atomičan, server RPC)
  menuService.ts, tableService.ts, settingsService.ts (patch umjesto upsert cijelog reda)
  persistence/localAdapter.ts, supabaseAdapter.ts   (isti interfejs → parity testovi)
src/store/
  slices/ authSlice, menuSlice, tableSlice, orderSlice, settingsSlice, stationSlice,
          inventorySlice (ingredients, kitchenEvents), calendarSlice, staffSlice (employees, shifts)
  hydration/ jedna funkcija hydrate(adapter) koju koriste login i AuthProvider
```
