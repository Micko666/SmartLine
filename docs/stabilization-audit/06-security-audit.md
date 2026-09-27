# 06 — Security / trust-boundary audit

Pretpostavka: browser je **potpuno nepouzdan**. Napadač ima anon ključ (javno ugrađen u JS bundle) i bilo koji `restaurant_token` (štampa se na QR kodovima stolova, u linkovima `/order`, `/book`, `/roster`, `/station`).

Oznake ozbiljnosti: **P0** = hitno (curenje PII ili finansijska manipulacija), **P1** = ozbiljno, **P2** = srednje, **P3** = nisko.

---

## Sažetak nalaza

| ID | Ozb. | Nalaz | Status |
|---|---|---|---|
| SEC-01 | **P0** | `anon_select_orders_realtime` / `anon_select_tables_realtime` (`USING (true)`) → anon čita **sve narudžbe svih tenanta** preko REST-a, uključujući PII kupaca u `notes` | CONFIRMED (policy + remote SET ROLE anon: 139 redova) |
| SEC-02 | **P0** | `atomic_checkout` vjeruje klijentu za količinu, modifiere i cijene modifiera → negativni/nulti totali, povećanje stock-a, besplatna roba | CONFIRMED (čitanje SQL-a) |
| SEC-03 | **P0** | `station_*` RPC ne traže PIN ni sesiju; samo `restaurant_token` (koji je na QR kodu stola) | CONFIRMED (remote tijela funkcija) |
| SEC-04 | **P0** | PIN-ovi stanica u plaintextu u `business_settings.stations`, vraćaju se anon-u kroz `get_customer_menu` | CONFIRMED |
| SEC-05 | P1 | `submit_booking` prihvata `p_status` i `p_type` od klijenta → samo-odobrene rezervacije i `closure` eventi (DoS kalendara) | CONFIRMED |
| SEC-06 | P1 | `get_roster_data` vraća `to_jsonb(employees)` → telefon i email zaposlenih javno | CONFIRMED |
| SEC-07 | P1 | `station_advance_order` postavlja proizvoljan status (i `refunded`, `served`), bez state machine-a | CONFIRMED |
| SEC-08 | P2 | `get_customer_menu` vraća `cost_per_serving`, `recipe`, `sales_count`, sve stolove sa koordinatama | CONFIRMED |
| SEC-09 | P2 | 7 SECURITY DEFINER funkcija bez `SET search_path` | CONFIRMED (advisor) |
| SEC-10 | P2 | Legacy 6-arg `atomic_checkout` i dalje anon-izvršiv (dupla površina) | CONFIRMED |
| SEC-11 | P2 | PII u URL-u (`addr=` query param) i u `orders.notes` (slobodan tekst) | CONFIRMED |
| SEC-12 | P2 | Nema rate limiting-a / abuse zaštite na javnim RPC-ovima | UNKNOWN (platform limiti nisu provjereni); u kodu ne postoji ništa |
| SEC-13 | P2 | `get_order_status` — uzastopni `order_number` → enumeracija statusa i imena stolova | CONFIRMED |
| SEC-14 | P3 | Local mode: lozinke u plaintextu u `localStorage['smartline-accounts']` | CONFIRMED (poznato, TODO #4) |
| SEC-15 | P3 | Supabase Auth: leaked password protection isključen | CONFIRMED (advisor) |
| SEC-16 | P3 | Table GRANT ALL za anon/authenticated (uklj. TRUNCATE) — zaštita samo RLS | CONFIRMED |
| SEC-17 | P3 | Public stranica u istom browseru poslije logout-a može vidjeti podatke prethodnog tenanta (`logout()` ne čisti calendarEvents/employees/shifts) | PLAUSIBLE |

---

## SEC-01 — Migracija 014: anon SELECT na `orders` i `tables`

```sql
CREATE POLICY "anon_select_orders_realtime" ON orders FOR SELECT TO anon USING (true);
CREATE POLICY "anon_select_tables_realtime" ON tables FOR SELECT TO anon USING (true);
```
(`supabase/migrations/014_fix_realtime_publications_and_station_rls.sql:33-41`)

**Efekat na REST API (PostgREST)** — CONFIRMED:
- `GET /rest/v1/orders?select=*` sa anon ključem vraća **sve redove svih tenanta**. RLS policies su OR-ovane, a ova je `true` za anon.
- Kolone: `id, user_id, order_number, table_id, table_name, items, status, subtotal, tax, total, payment_method, notes, scheduled_for, ...`.
- `notes` za takeaway/delivery sadrži `Name: …`, `Phone: …`, `Address: …` (`src/pages/customer/Menu.tsx:362-372`) → **puno ime, telefon i adresa svakog delivery kupca**.
- `user_id` otkriva UUID vlasnika restorana.
- Remote potvrda: kao `anon` je vidljivo 139 narudžbi i 12 stolova.
- Komentar u 014 ("Actual order data is only returned through station_get_orders, so this policy just unblocks the realtime channel trigger") je **netačan**: policy otvara i REST, ne samo Realtime.

**Efekat na Realtime** — CONFIRMED (po dizajnu Supabase Realtime-a):
- Postgres Changes provjerava SELECT RLS za rolu pretplatnika. Anon pretplatnik dobija INSERT/UPDATE payload-e.
- Filter `user_id=eq.X` bira klijent, pa napadač može izostaviti filter i slušati narudžbe **svih** tenanta uživo.

**Zašto je uvedeno:** station uređaji su anon, a `useStationOrders` sluša `orders` i `tables` (`useStationOrders.ts:62-85`).
**Pravilno rješenje (za plan):** Realtime Broadcast / private channel sa JWT-om stanice, ili custom JWT claim `restaurant_id` + policy `USING (user_id = (auth.jwt()->>'tenant')::uuid)`.

---

## SEC-02 — `atomic_checkout`: šta klijent kontroliše

Konačna verzija: `supabase/migrations/013_scheduled_for_and_business_hours.sql:36-257`.

| Parametar | Šta server radi | Zloupotreba |
|---|---|---|
| `p_restaurant_token` | Zaključava settings red, izvodi `user_id` | — (dobro) |
| `p_cart[].menuItemId` | `::uuid` cast + `user_id` scope | Nevalidan UUID → exception → rollback (OK) |
| `p_cart[].quantity` | `(…)::int` **bez provjere znaka** | `-5` → stock check `v_effective < -5` je false → prolazi; `stock = stock - (-5)` **povećava stock**; `sales_count` opada; `lineTotal` negativan → **negativan total**. `0` → narudžba od 0. Decimalni string (npr. `"1.5"`) → exception. |
| `p_cart[].resolvedModifiers` | Sabira `priceAdjustment` **iz klijentskog JSON-a**; upisuje ga u `items[].modifiers` | Izmišljen modifier `{"priceAdjustment": -100}` → proizvoljno niska cijena. Server **ne čita** `menu_items.modifiers`. Nema provjere da modifier/opcija postoji, `required` ni `maxSelections`. |
| `p_payment_method` | Upisuje se bez provjere | Bilo koji string; narudžba je uvijek `status='paid'` — **nema stvarnog plaćanja** ni za jedan metod |
| `p_table_id` | Regex UUID → lookup; inače keyword ili **sirovi string kao `table_name`** | Proizvoljan tekst u `table_name` (prikazuje se u kuhinji i adminu). UUID stola drugog tenanta → lookup vraća NULL → ime = UUID string, sto se ne mijenja (scope OK). |
| `p_notes` | Upisuje se | Neograničena dužina; PII |
| `p_scheduled_for` | `NULLIF(TRIM(...),'')` | Bilo koji tekst, prošlost, van radnog vremena |
| `p_session_id` | Isključuje sopstvenu rezervaciju iz računice | Napadač može koristiti tuđi `session_id` da ignoriše tuđu rezervaciju (rezervacije za anon ionako ne postoje u DB-u, vidi 08) |
| — | `ordering_paused` se provjerava ✔ | — |
| — | `takeaway_enabled` / `delivery_enabled` se **NE** provjeravaju | Takeaway/delivery narudžba i kad je kanal isključen |
| — | `business_hours` se **NE** provjerava | Narudžba van radnog vremena |

Cijena osnovnog artikla (`v_item.price`) se čita iz DB-a ✔. Porez i total se računaju server-side ✔, ali nad nevalidiranim količinama i modifierima.

**Pitanja iz zadatka:**
- Cijena server-side? — Osnovna DA, modifier NE.
- Quantity validirana? — NE (samo `::int`).
- Modifier ID validiran? — NE.
- Modifier cijena iz DB-a? — NE, iz klijentskog JSON-a.
- Status bira caller? — NE, uvijek `paid`.
- Tenant/user_id bira caller? — Indirektno kroz token (koji je javan); `user_id` direktno NE.
- UUID drugog tenanta? — menu item i sto su scope-ovani na `user_id` → odbijeno/ignorisano ✔.

Dodatni bag u istoj funkciji (korektnost, ne security): stock se oduzima u petlji **prije** nego što se zna da li su svi artikli dostupni. Ako je kasniji artikal nedostupan, funkcija radi `RETURN success=false`, a pošto u PL/pgSQL-u `RETURN` ne radi rollback, **oduzeti stock za ranije artikle se commit-uje**. Vidi 08 / BUG-02.

---

## SEC-03 / SEC-07 — Station RPC bez autentikacije
Detaljno u `07-station-audit.md`. Ukratko: svako ko zna `restaurant_token` (dovoljno je skenirati QR stola) može:
- čitati sve aktivne i otkazane narudžbe sa PII (`station_get_orders`),
- postaviti bilo koju narudžbu na bilo koji status iz CHECK-a (`station_advance_order`), npr. `refunded` ili `completed`,
- mijenjati prep time bez granica,
- ubacivati proizvoljne kitchen evente (utiču na analitiku waste/remake).

## SEC-04 — PIN-ovi
`get_customer_menu` (013:260-374) uključuje `'stations', COALESCE(bs.stations,'[]')`. Station objekat sadrži `pin` (`src/domain/types.ts:270`). Kupac koji otvori meni dobija PIN-ove svih stanica u JSON odgovoru. PIN je plaintext i provjerava se na klijentu (`src/pages/station/StationGate.tsx:173`). Remote trenutno nema postavljenih PIN-ova, pa je stvarna izloženost danas 0, ali je dizajn neispravan.

## SEC-05 — `submit_booking`
`supabase/migrations/011_uuid_generate_fix.sql:235-285`:
- `COALESCE(NULLIF(p_status,''),'pending')` → klijent šalje `approved` → **zaobilazi `requireApproval`**. UI to čak i radi kada je `requireApproval=false` (`BookingPage.tsx:252`), ali odluka je na klijentu.
- `p_type = 'closure'` + `p_status = 'approved'` → `BookingPage.isAvailableDay` (`:217`) blokira taj dan za sve kupce → **jeftin DoS rezervacija**. Admin kalendar ga prikazuje kao zatvaranje.
- Nema validacije datuma (prošlost, format, `advanceBookingDays`), vremena, `maxEventsPerDay`, radnih dana/izuzetaka, `guest_count` (0, negativno, 10 000), postojanja/aktivnosti paketa, `min/maxGuests` paketa, dužine polja.
- `created_by` je hardkodovan na `'customer'` ✔.

## SEC-06 — Roster
`get_roster_data` (002:236-273) vraća `to_jsonb(e)` za aktivne zaposlene → `phone`, `email`, `user_id`, `created_at`. Vraća i **sve smjene ikada** (bez vremenskog okvira). `RosterPage` ne prikazuje telefon/email (grep: nema upotrebe) → **nepotrebno izlaganje PII**.

## SEC-08 — Prekomjerni podaci u `get_customer_menu`
Vraća marže (`cost_per_serving`), recepte, `sales_count`, `max_stock`, sve stolove (koordinate, zone), `app_url`, `stations` (sa PIN-ovima). UI kupca od toga ne koristi ništa osim `stock`, `status` i prikaznih polja. Vidi `10-data-exposure` sekciju u `08-ordering-audit.md` §9.

## SEC-11 — PII tokovi
- Adresa ide kroz URL: `/menu?...&addr=…` i `/receipt/:id?...&addr=…` (`OrderPortal.tsx:154`, `Menu.tsx:414`, `Receipt.tsx:104`). Završava u istoriji browsera, Vercel access logovima i `Referer` headeru.
- Ime/telefon/adresa se spajaju u `orders.notes` (slobodan tekst). U kombinaciji sa SEC-01 to je javno. `receipts` ne sadrži notes ✔.

## SEC-13 — `get_order_status`
`(token, order_number)` → status, ime stola, prep vrijeme, `paidAt`. Brojevi su sekvencijalni od 1001. PII nije uključen, ali se može pratiti promet restorana. `/track` stranica nije linkovana iz aplikacije (vidi 11).

## SEC-17 — Stale state poslije logout-a
`logout()` (`src/store/index.ts:348-362`) ne resetuje `calendarEvents`, `eventPackages`, `calendarSettings`, `employees`, `shifts`. `BookingPage` u local modu čita `storeState.calendarEvents` (`:143-148`, uključujući `customerPhone`/`customerName`) ako se token poklapa. Scenarij sa različitim tokenom — UNKNOWN. Nizak rizik.

---

## Trust-boundary mapa (šta je stvarno na serveru)

| Pravilo | Client | Server |
|---|---|---|
| Tenant izolacija za owner CRUD | — | ✔ RLS `auth.uid()=user_id` |
| Tenant izolacija za public čitanje | — | ✔ RPC scope po tokenu; ✘ `orders`/`tables` anon policy |
| Cijena artikla | ✔ | ✔ |
| Cijena modifiera | ✔ | ✘ |
| Količina > 0 | implicitno (UI +/-) | ✘ |
| Stock ≥ 0 | ✔ (`Math.max(0, …)`) | djelimično (provjera u checkout-u, bez CHECK constraint-a) |
| Ordering paused | ✔ | ✔ |
| Kanal enabled | ✔ | ✘ |
| Radno vrijeme | ✔ (samo OrderPortal) | ✘ |
| Order state machine | ✔ (`orderMachine.ts`) | ✘ (owner UPDATE i `station_advance_order` pišu bilo šta iz CHECK-a) |
| Booking approval | ✔ | ✘ |
| Station PIN | ✔ | ✘ |
| Station permissions | ✔ | ✘ |
