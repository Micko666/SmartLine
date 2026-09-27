# 07 — Station subsystem audit

## 1. Tok

```text
/station/:restaurantToken/:stationId                        (src/App.tsx, public)
→ StationGate                                               (src/pages/station/StationGate.tsx:81)
   → fetchRestaurantByToken(token) = RPC get_customer_menu  (:103)
      local fallback: samo ako !Supabase && store.settings.restaurantToken === token && store.user (:107-117)
   → station = settings.stations.find(id)                   (:121)
   → useStore.setState({menuItems, tables, settings, stations}) (:129)  — "injektuje" tenant podatke u store
   → normalizeStation(found)                                (:137)
   → if (!found.pin || isSessionValid(stationId)) openSession + unlock (:142-145)
   → inače PIN numpad; pin === station.pin (client) → openSession (:169-182)
→ STATION_VIEWS[station.role]  → KitchenStation | BarStation | ServiceStation (custom → ServiceStation)
   → useStationOrders(token, userId, stationId)             (src/lib/supabase/realtime/useStationOrders.ts:29)
      Supabase: rpc station_get_orders + 30s poll + realtime (orders INSERT/UPDATE, tables UPDATE) + visibilitychange
      Local:    store.orders filtrirani na paid/preparing/ready
   → akcije: advanceOrder / adjustPrepTime / logKitchenEvent / remakeOrder
      Supabase: rpc station_advance_order / station_adjust_prep_time / station_log_kitchen_event
      Local:    store.advanceOrderStatus / cancelOrder / adjustPrepTime / logKitchenEvent
   → table status (Service/Bar): store.setTableStatus  (ServiceStation.tsx:138,169; BarStation.tsx:193)
```

## 2. Odgovori na pitanja

| Pitanje | Odgovor | Dokaz |
|---|---|---|
| Gdje se PIN čuva? | `business_settings.stations[].pin` (jsonb), plaintext. U local modu isto, unutar `settings.stations` u localStorage. | `types.ts:270`, `mappers.ts:38,65` |
| Može li public client dobiti PIN? | **DA.** `get_customer_menu` je anon RPC i vraća `settings.stations` bez filtriranja polja. Ne treba ni ući na station URL — dovoljan je meni. | `013:294` (`'stations', COALESCE(bs.stations,'[]')`) |
| PIN plaintext u business_settings.stations? | **DA.** Nema hashiranja ni na jednom mjestu (grep: nema `hash`/`bcrypt`/`crypt`). | — |
| Šta `get_customer_menu` vraća za stations? | Cijeli jsonb niz: `id, name, role, pin, color, permissions{...}, createdAt`. | isto |
| Da li station RPC provjerava PIN ili sesiju? | **NE.** Sva 4 `station_*` tijela (remote) provjeravaju samo da `restaurant_token` postoji i da narudžba pripada tenant-u. Parametar za PIN, station id (osim `p_station_id` u log-u, koji je informativan) ili sesiju ne postoji. | remote `pg_get_functiondef` (05 §6) |
| Station permissions — samo UI ili i server? | **Samo UI.** `canCancelOrders`, `canAdjustPrepTime`, `canReworkOrders`, `canLogKitchenEvents`, `canUpdateTableStatus`, `visibleStatuses`, `filterCategories` se čitaju samo u React komponentama. | `KitchenStation.tsx:396-397,490-493`, `BarStation.tsx:127-136,173-174`, `ServiceStation.tsx:125,164-165` |
| Može li anon direktno pozvati station RPC? | **DA.** `has_function_privilege('anon', …, 'EXECUTE') = true` za sva 4 (5 overload-a); advisor `anon_security_definer_function_executable`. | remote |
| Može li kitchen station pozvati service-only operaciju? | **DA.** Npr. `POST /rest/v1/rpc/station_advance_order {p_new_status:'cancelled'}` sa kitchen uređaja (kitchen preset ima `canCancelOrders:false`). Server ne zna koja stanica zove. Čak ni ne-stanica (kupac sa QR tokenom) nije razlikovana. | — |
| Da li stanica može mijenjati status stola? | U Supabase modu **ne perzistira**: `setTableStatus` šalje bridge samo ako `get().user?.id` (`store/index.ts:616`), a stanica nema korisnika. Promjena je samo lokalna u memoriji uređaja; anon ionako nema UPDATE policy na `tables`. | CONFIRMED statički |

## 3. Pronađeni problemi

| ID | Problem | Posljedica | Status |
|---|---|---|---|
| ST-01 | PIN izložen kroz `get_customer_menu` | Svaki kupac može otključati svaku stanicu | CONFIRMED |
| ST-02 | PIN provjera samo na klijentu; sesija = `localStorage['sl-station-{id}'] = {expiresAt}` | Ručno postavljanje localStorage ključa zaobilazi PIN; pogađanje PIN-a nije ograničeno (`wrongAttempts` samo prikazuje poruku, bez lockout-a, `StationGate.tsx:94,261`) | CONFIRMED |
| ST-03 | RPC-ovi ne znaju za stanicu ni PIN | Autorizacija = posjedovanje `restaurant_token` (koji je na svakom QR-u stola) | CONFIRMED |
| ST-04 | `station_advance_order` upisuje proizvoljan status | `ready → paid`, `completed → refunded`, `served` (nepoznat UI-ju) itd. | CONFIRMED |
| ST-05 | Remote cancel ne vraća stock i ne oslobađa sto; local `cancelOrder` vraća stock i oslobađa sto (`store/index.ts:689-704`) | Local/Supabase divergencija; stock "curi" kod otkazivanja sa stanice | CONFIRMED |
| ST-06 | Remake: local `localRemakeOrder` poziva `advanceOrderStatus` (naprijed, npr. `ready → completed`!), remote `remoteRemakeOrder` postavlja `preparing` | Suprotna semantika u dva moda | CONFIRMED (`useStationOrders.ts:129-141` vs `:213-224`) |
| ST-07 | `station_advance_order` / `adjust_prep_time` ne ažuriraju `updated_at` | Admin sortiranje i analitika koriste zastarjeli `updatedAt` (lokalni patch ga postavlja, DB ne) | CONFIRMED |
| ST-08 | `station_adjust_prep_time` bez clamp-a; store clampuje na [-60, 180] (`store/index.ts:726`) | Divergencija; proizvoljne vrijednosti | CONFIRMED |
| ST-09 | `station_get_orders` vraća `SELECT *` za sve statuse osim completed/refunded, bez vremenskog limita | Uključuje sve otkazane narudžbe ikada → raste zauvijek; uključuje `notes` sa PII | CONFIRMED |
| ST-10 | Table status sa stanice se ne perzistira u Supabase modu | Service stanica "oslobodi sto", admin i kupci i dalje vide `occupied` | CONFIRMED statički |
| ST-11 | Realtime za stanice radi samo zbog SEC-01 (anon SELECT `USING true`) | Popravka SEC-01 bez zamjene mehanizma → stanice padaju na 30 s polling | CONFIRMED (komentar u 014) |
| ST-12 | Local mode stanica radi samo u browseru gdje je admin ulogovan (`state.user` uslov, `StationGate.tsx:109`) | "Station device" u local modu nije poseban uređaj; dokumentacija (`useStationOrders.ts:12-14`) to prikazuje kao punu podršku | CONFIRMED |
| ST-13 | `StationGate` upisuje tenant podatke u globalni store (`useStore.setState`) | Ako je admin ulogovan u istom tabu/browseru, station ruta prepisuje `settings/menuItems/tables` admin store-a; `_persistLocal` bi ih zatim sačuvao | PLAUSIBLE |
| ST-14 | `SESSION_KEY(stationId)` ne uključuje token restorana | Isti stationId u dva restorana je praktično nemoguć (UUID) → nizak rizik | CONFIRMED, P3 |
| ST-15 | `custom` rola renderuje `ServiceStation` (`StationGate.tsx:30`) | Custom stanica sa `canLogKitchenEvents`/`canAdjustPrepTime` nema UI za te akcije (ServiceStation ih ne prikazuje) → permission bez efekta | CONFIRMED |

## 4. Kako bi trebalo modelovati station autentikaciju (preporuka, ne implementacija)

1. **Station credential na serveru**: nova tabela `stations(id, user_id, name, role, permissions jsonb, pin_hash, created_at)`. PIN hash preko `pgcrypto` `crypt()` / bcrypt. Ukloniti `stations` iz `business_settings` i iz svih public RPC-ova.
2. **Pairing / login RPC**: `station_login(p_station_id, p_pin)` (SECURITY DEFINER, rate-limited brojačem neuspjelih pokušaja u tabeli) → vraća kratkotrajan **signed station token**. Opcije:
   - Supabase Edge Function koja potpisuje JWT sa claim-ovima `{role:'station', tenant:<user_id>, station_id, perms}` koristeći JWT secret projekta → klijent ga koristi kao `Authorization` → RLS i Realtime rade preko `auth.jwt()`.
   - Ili opaque session token u tabeli `station_sessions(token_hash, station_id, expires_at)`, koji svaki `station_*` RPC provjerava.
3. **Autorizacija u RPC-u**: svaki `station_*` prima session/JWT, čita station permissions **iz DB-a** i provjerava ih (npr. `cancelled` samo ako `canCancelOrders`). Tranzicije idu kroz SQL verziju state machine-a (`can_transition(from, to)`).
4. **Realtime**: ukloniti `anon_select_*` policies. Stanice koriste authenticated JWT sa tenant claim-om (policy `USING (user_id = (auth.jwt()->>'tenant')::uuid)`) ili Realtime Broadcast iz triggera na privatni kanal `station:<tenant>`.
5. **Cancel/stock**: jedna serverska funkcija `cancel_order(order_id, actor)` koja vraća stock i oslobađa sto atomično, a koju koriste i admin i stanica.
6. **Table status**: `station_set_table_status(session, table_id, status)` sa provjerom `canUpdateTableStatus`.
