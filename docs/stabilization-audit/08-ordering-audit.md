# 08 — Customer ordering audit

## 1. Stvarni tokovi (kod, ne dokumentacija)

### Takeaway
```text
/order/:token                               OrderPortal.tsx:250
  load: store (local, getPersistedSettings) → ili RPC get_customer_menu (:266-303)
  gate: orderingPaused → ClosedScreen (:324); checkOpenStatus(businessHours) → ClosedScreen (:328)
  izbor: Takeaway (disabled ako !takeawayEnabled) (:371)
  ScheduleStep (:129)  ── CRASH: ReferenceError noSlotsToday (:209) — tok se ovdje prekida
    (namjera) date + 15-min slot (min +30 min danas, unutar businessHours) → navigate /menu?mode=takeaway&r&date&time (:151-156)
/menu?mode=takeaway&r&date&time             Menu.tsx:113
  Supabase: fetchRestaurantByToken → useStore.setState({menuItems, settings, tables}) (:161-175)
  Local:    koristi postojeći store (radi samo ako je admin ulogovan u istom browseru)
  needsModeSelection? (nema t ni mode) → ModeSelectorScreen (:433)
  mode disabled? → ModeUnavailableScreen (:461-466)
  nema date/time? → SchedulingStep fallback (:471-505) — BEZ businessHours filtera
  cart (useState, persist u localStorage smartline-customer-{token}) (:182-247)
  "Proceed" → validateCart + createReservation(SESSION_ID) (:346-353)
  PaymentSheet → ime + telefon obavezni (:292-296) → handlePayment (:356)
     notes = "Pickup: …\nName: …\nPhone: …" + korisničke napomene (:361-373)
     checkout({tableId:'takeaway', scheduledFor:'YYYY-MM-DD HH:MM', ...}) (:375)
        Supabase: rpc atomic_checkout (store/index.ts:942)
        Local:    _localCheckout (store/index.ts:1307)
  uspjeh → saveSession(placedOrderIds) → navigate /receipt/:id?r&mode&date&time (:389-416)
/receipt/:id                                Receipt.tsx
  store → ili rpc get_receipt_by_id; "Order More" → /menu?mode&r&date&time[&addr] (:91-107)
```

### Delivery
Isto, uz obaveznu adresu u `ScheduleStep` (`OrderPortal.tsx:149`) i u `PaymentSheet` (`Menu.tsx:296`). Adresa putuje kroz URL (`addr=`) i završava u `orders.notes`. `cash` ("Pay on Pickup") je sakriven za delivery (`Menu.tsx:100`).

### Dine-in — dokumentacija NE odgovara kodu
- `CLAUDE.md`: "`/order/:token` → pick table → `/menu?t={id}&r={token}`". **Netačno.** `OrderPortal` nema table picker: header komentar (`OrderPortal.tsx:5-9`) navodi samo takeaway/delivery, a UI nudi samo ta dva dugmeta.
- Stvarni dine-in tok: **QR kod stola** (generiše se u `Tables.tsx`, `makeQrDownloader`) → `/menu?t={tableId}&r={token}` → cart → pay → receipt.
- `/menu?r=token` bez `t`/`mode` → `ModeSelectorScreen` → klik "Dine In" → `navigate('/order/:token')` (`Menu.tsx:436-439`) → portal nudi samo takeaway/delivery → **mrtva petlja za dine-in**.
- `/menu` bez `t` u dine-in modu → `effectiveTableId = 'walk-in'` (`Menu.tsx:133-135`).
- Nevalidan `t` (npr. obrisan sto) → upozorenje "Table not found" (`Menu.tsx:554`), ali checkout se i dalje izvršava: server upisuje UUID string kao `table_name` (vidi 06 SEC-02).

## 2. Edge case matrica

| Tema | Nalaz | Status |
|---|---|---|
| **Business hours** | Provjerava se samo u `OrderPortal` (`checkOpenStatus`). `/menu` direktno (QR stola, "Order More", deep link) **ne provjerava** radno vrijeme. Server ne provjerava. Dine-in nikad nije gate-ovan radnim vremenom. | CONFIRMED |
| **Business hours preko ponoći** | `closeTime < openTime` (npr. 18:00–02:00) → `nowMins >= closeMins` je uvijek true poslije 02:00 → "closed"; slot petlja `mins < windowClose` ne generiše ništa. | CONFIRMED statički |
| **Timezone** | `settings.timezone` se **nigdje ne koristi** (samo input u Settings.tsx:135). Radno vrijeme se računa u timezone-u **uređaja kupca**. Kupac u drugoj zoni vidi pogrešno open/closed. | CONFIRMED |
| **Local date vs UTC** | `todayStr()` = `new Date().toISOString().slice(0,10)` (**UTC datum**) u `OrderPortal.tsx:34`, `Menu.tsx:54,55,65`, `Receipt.tsx` (fmtScheduled), `BookingPage.tsx:28-29`, `Calendar.tsx:36-37`, `DashboardLayout.tsx:52`, `Orders.tsx:42-43`, `Analytics.tsx:90,120,185`. U CE(S)T (UTC+1/+2) između 00:00 i 01:00/02:00 lokalno "danas" = jučerašnji UTC datum → `<input type=date min=…>` dozvoljava jučer; `isToday` je false za stvarni današnji datum → slotovi za danas **bez 30-min buffera**, uključujući prošla vremena. | CONFIRMED statički |
| **Local vs UTC nekonzistentnost** | `Orders.tsx:55` `dayKey()` koristi lokalni datum; `DashboardLayout.tsx:52-56` badge koristi UTC slice od `createdAt` → badge i "Today" sekcija se razlikuju oko ponoći. | CONFIRMED |
| **Scheduled date** | Server ne validira `scheduled_for` (format, prošlost, radno vrijeme). Klijent može poslati bilo šta preko URL-a (`/menu?mode=takeaway&date=2020-01-01&time=99:99`). `Menu` ne re-validira date/time iz URL-a. | CONFIRMED |
| **Slot generation** | Dvije implementacije: `OrderPortal.getAvailableTimeSlots` (poštuje businessHours) i `Menu.getSchedulingSlots` (06:00–24:00, ignoriše businessHours). Fallback `SchedulingStep` u Menu-u tako nudi termine van radnog vremena. | CONFIRMED |
| **30-min buffer** | `Math.ceil((now + 30)/15)*15` — ispravno u lokalnom vremenu; pogrešno kad je `isToday` pogrešan (UTC bug). Buffer se ne provjerava ponovo pri plaćanju — kupac koji 20 min stoji na payment ekranu naručuje za slot koji je sada < 30 min. | CONFIRMED |
| **Channel enable/disable** | UI: `OrderPortal` onemogućava dugme, `Menu` prikazuje `ModeUnavailableScreen`. Server: **ne provjerava**. Race: admin isključi kanal dok je kupac u korpi → narudžba prolazi. | CONFIRMED |
| **Ordering pause** | UI: OrderPortal + ModeSelectorScreen. **Dine-in QR `/menu?t=…` ne prikazuje pause screen** (pause se renderuje samo u `needsModeSelection` grani, `Menu.tsx:433-458`), ali server odbija checkout ("Ordering is currently paused") → kupac napuni korpu i tek pri plaćanju dobije grešku. Local `_localCheckout` pause **uopšte ne provjerava**. | CONFIRMED |
| **Customer data** | Ime/telefon obavezni za takeaway/delivery (samo `trim().length > 0`, bez formata). Upisuju se u `notes` kao tekst → nema strukturisanog `customer_name/phone/address` na `orders`. Nema saglasnosti/GDPR teksta. | CONFIRMED |
| **Notes** | Bez limita dužine (client i server). Spajanje sa `---` separatorom — admin UI mora parsirati tekst. | CONFIRMED |
| **Receipt "Order More"** | Za takeaway/delivery nosi stari `date/time` → novi order za isti (možda već prošli) slot, bez re-validacije. Za walk-in (dine-in bez `t`) nema "Order More" (`Receipt.tsx:94-107`). `PAYMENT_LABELS.cash = 'Pay at Counter'` (`Receipt.tsx:10`) ≠ Menu label "Pay on Pickup". | CONFIRMED |
| **Cart restoration** | Korpa se vraća iz `smartline-customer-{token}` samo ako se `tableId` poklapa i **nema placedOrderIds** (`Menu.tsx:185`) → poslije prve narudžbe, refresh briše korpu druge runde. Session TTL postoji (`customerSession.ts`). Cijene u sesiji se ne koriste za naplatu ✔. | CONFIRMED |
| **Reservation lifecycle** | `SESSION_ID` je random po učitavanju stranice (`Menu.tsx:20`) → refresh = nova sesija. `createReservation` u Supabase modu upisuje u DB samo ako `user?.id` (`store/index.ts:900`) — **kupac je anon → rezervacija postoji samo u memoriji njegovog taba**. Server-side rezervacije za kupce faktički ne postoje; zaštita od overselling-a je samo `FOR UPDATE` u `atomic_checkout` (koji je ispravan). Release na unmount (`Menu.tsx:249`). TTL 5 min se ne osvježava tokom payment ekrana. | CONFIRMED |
| **Double-submit** | Dugme se disable-uje preko React state-a `checkoutLoading` (`Menu.tsx:358`, `:1448`). Dva klika u istom tick-u prije re-render-a mogu pozvati `handlePayment` dva puta. Server **nema idempotency key** → 2 narudžbe, 2× stock. | PLAUSIBLE |
| **Refresh / back** | Poslije uspjeha `navigate` na receipt; Back vraća na `/menu` sa praznom korpom ✔. Refresh na receipt-u: store ga nema → Supabase fetch ✔; local mode: receipt je u store-u samo ako je admin workspace hidratisan. Refresh u sred plaćanja: nema pending-order stanja → korisnik ne zna je li plaćeno. | CONFIRMED / PLAUSIBLE |
| **Stale menu/stock** | Kupac dobija meni jednom (RPC). `useMenuSubscription` sluša `menu_items` UPDATE kao **anon**, ali od migracije 009 anon nema SELECT policy na `menu_items` → **Realtime ne isporučuje događaje** → stock u meniju je zamrznut. Komentar u `useMenuSubscription.ts:9-10` ("RLS policy allows public reads of active items") je zastario. | CONFIRMED (policy analiza) |
| **Zero stock** | `zeroStockBehavior='hide'` → sakriveno (`Menu.tsx:256`); `'disable'` → prikazano sa "Unavailable". `validateCart` označava `out_of_stock` samo ako je behavior `hide` (`store/index.ts:857`); inače `insufficient_stock`. Server odbija ✔. | CONFIRMED |
| **Modifiers** | `required` se provjerava u `validateCart` ✔ (client). `maxSelections` — ne provjerava se u `validateCart`; `ItemSheet` tretira samo `maxSelections === 1` kao radio (`Menu.tsx:1032,1115`), za `maxSelections > 1` nema limita (checkbox bez ograničenja). Server ne provjerava ništa od toga i vjeruje cijeni (06 SEC-02). Korpa grupiše isti artikal sa različitim modifierima kao odvojene linije, ali `updateQty` / `removeFromCart` rade po `menuItemId` (`Menu.tsx:310-317`) → **mijenjaju sve linije tog artikla odjednom**. | CONFIRMED |
| **addToCart stock check** | `inCart` gleda samo prvu liniju sa tim `menuItemId` (`Menu.tsx:301`) → sa više modifier varijanti može se dodati više od dostupnog (server kasnije odbije). | CONFIRMED |
| **Payment method** | Nema payment provider-a. Svaki metod (card, Google Pay, Apple Pay, cash) odmah kreira `status='paid'`. "Pay on Pickup" narudžba je takođe `paid` i ulazi u prihod. | CONFIRMED |
| **Scheduled orders u kuhinji** | Narudžba za sutra ulazi odmah kao `paid` u kuhinjski red; `station_get_orders` i Orders UI sortiraju po `created_at`, ne po `scheduled_for`. | CONFIRMED |
| **Partial stock leak** | `atomic_checkout`: ako je artikal #2 nedostupan, stock artikla #1 je već umanjen, a `RETURN success=false` commit-uje transakciju → **stock trajno umanjen bez narudžbe**. Local `_localCheckout` provjerava sve prije oduzimanja ✔ (divergencija). | CONFIRMED statički (PL/pgSQL semantika) |
| **Order number uniqueness** | Server: zaključan settings red + increment → sekvencijalno ✔, ali nema UNIQUE constraint-a. Owner `upsertSettings(…, nextOrderNumber)` može vratiti brojač unazad (signup/hydration/pushLocalToSupabase putanje). Local store poslije Supabase checkout-a radi `nextOrderNumber + 1` lokalno (`store/index.ts:1009`) — nebitno, ali zbunjujuće. | CONFIRMED / PLAUSIBLE |
| **Table occupancy** | Checkout postavlja `occupied`; niko ga automatski ne vraća. Oslobađanje: admin (Orders "clear"), service stanica (samo lokalno u Supabase modu, 07 ST-10), `cancelOrder` (samo ako je bio `occupied`). | CONFIRMED |

## 3. Local vs Supabase razlike u ordering-u

| Aspekt | Local (`_localCheckout`) | Supabase (`atomic_checkout`) |
|---|---|---|
| Ordering paused | ✘ ne provjerava | ✔ |
| Parcijalna nedostupnost | provjerava sve pa oduzima ✔ | oduzima u toku petlje ✘ (leak) |
| Modifier cijene | iz `menuItems` u store-u ✔ | iz klijentskog JSON-a ✘ |
| Table name za keyword | `MODE_NAMES` map | SQL `CASE` (isti rezultat) |
| Table occupied | `tables.find(id)` (radi i za `tbl-1` seed ID) | samo UUID regex |
| scheduledFor | upisuje se bez trim-a | `NULLIF(TRIM())` |
| Receipt.restaurantName | `settings.businessName` | `v_settings.business_name` |
| Negativna količina | prolazi (nema provjere) | prolazi |

## 4. Preporučeni testovi (za Phase 1)
- `OrderPortal` render test: ScheduleStep se renderuje za today bez izuzetka.
- Unit: generator slotova (today/UTC granica, overnight hours, closed day, buffer).
- SQL (pgTAP ili integration nad lokalnim Supabase-om): `atomic_checkout` sa qty ≤ 0, lažnim modifierom, parcijalnom nedostupnošću (stock ostaje netaknut), disabled kanalom, pauzom, van radnog vremena.
- E2E: takeaway i delivery happy path; dine-in QR happy path; Order More.

## 9. Data exposure — public RPC odgovori (dio zadatka §10)

| RPC | Vraćena polja | PII | UI koristi? | Nepotrebno poslato |
|---|---|---|---|---|
| `get_customer_menu` | `ok, userId, settings{business_name…logo_url, restaurant_token, ordering_paused(+msg), takeaway/delivery_enabled, business_hours, **stations**}, menuItems[{id…recipe, cost_per_serving, sales_count, max_stock, created_at, updated_at}], tables[{id, number, name, capacity, status, shape, zone, floor, rotation, x, y, size_scale, created_at}]` | **Station PIN** | Meni prikaz, stock, status, tables za dine-in ime | `userId`, `stations` (osim za StationGate), `cost_per_serving`, `recipe`, `sales_count`, `max_stock`, `low_stock_threshold`, `app_url`, koordinate stolova |
| `get_booking_data` | `calendarSettings` (cijeli jsonb, uklj. `shiftTemplates`, `weekTemplate` → interni raspored smjena), `eventPackages` (`to_jsonb(ep)` → uklj. `user_id`), `calendarEvents[{id, date, time_slot, type, status}]` | Nema kupčevog PII ✔ | settings, paketi, zauzetost | `shiftTemplates`, `weekTemplate`, `user_id` paketa, `id` eventa |
| `submit_booking` | `{ok, eventId}` | — | ok | — |
| `get_roster_data` | `businessName`, `employees` = `to_jsonb(e)` (**phone, email**, user_id…), `shifts` = `to_jsonb(s)` svih vremena (uklj. `employee_ids`, `notes`) | **Telefon i email zaposlenih** | ime, boja, rola; smjene | phone, email, user_id, istorijske smjene, notes |
| `get_order_status` | `orderNumber, status, tableName, estimatedPrepTime, prepTimeAdjustment, paidAt, restaurantName` | — | sve | — |
| `get_receipt_by_id` | `id, orderId, orderNumber, tableId, tableName, restaurantName, items, subtotal, taxRate, taxAmount, total, paymentMethod, createdAt` | — (notes nije uključen ✔) | sve | `orderId`, `tableId` |
| `station_get_orders` | `orders = row_to_json(*)` | **notes (ime, telefon, adresa)**, `user_id` | stanice | notes za bar/kitchen (možda korisno), `user_id` |
| REST `orders` (SEC-01) | sve kolone, svi tenanti | **notes** | — | sve |
| REST `tables` (SEC-01) | sve kolone, svi tenanti | — | — | sve |

Bookings: kupčev PII (ime, telefon, email) nije izložen kroz `get_booking_data` ✔. Zato phone lookup ne radi u Supabase modu (09 BK-06).
