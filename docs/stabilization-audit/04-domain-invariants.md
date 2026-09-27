# 04 — Domain invariants

Kolone: **Client** = provjera u browseru (store/UI); **Server** = provjera u Postgres-u (constraint/RPC/RLS); **Testirano** = postoji automatski test. Rizik: H/M/L.

| # | Invariant | Gdje se provjerava | Client | Server | Testirano | Rizik |
|---|---|---|---|---|---|---|
| I-01 | Validna tranzicija statusa narudžbe (`paid→preparing→ready→completed`, `→cancelled→refunded`) | `domain/orderMachine.ts:10-17`; store `advance()` | ✔ (store) | ✘ Owner UPDATE i `station_advance_order` upisuju bilo šta iz CHECK-a (uklj. `served`) | ✔ unit (orderMachine, 25 testova) | **H** |
| I-02 | Status ∈ poznati skup | TS `OrderStatus` (6) vs DB CHECK (7, `served`) | ✔ | ✔ CHECK, ali skupovi se razlikuju | ✘ | M |
| I-03 | `stock >= 0` | store `Math.max(0, …)`; `atomic_checkout` stock check | ✔ | djelimično: nema CHECK constraint-a; negativna qty povećava stock; station/owner UPDATE bez granica | ✔ (`adjustStock never below 0`, local) | **H** |
| I-04 | `quantity > 0` (cijeli broj) | UI +/- dugmad | implicitno | ✘ (`::int` bez znaka) | ✘ | **H** |
| I-05 | Total = f(server cijena, server modifier cijena, qty, porez) | `atomic_checkout` | lokalno ✔ | **djelimično**: osnovna cijena iz DB-a, modifier iz klijentskog JSON-a | ✔ local only | **H** |
| I-06 | Modifier postoji, pripada artiklu, `required` zadovoljen, ≤ `maxSelections` | `validateCart` (samo required); ItemSheet (samo max=1) | djelimično | ✘ | ✔ (disabled/missing item; required — ✘) | H |
| I-07 | Stock se oduzima samo ako se narudžba kreira (all-or-nothing) | `_localCheckout` ✔; `atomic_checkout` ✘ (parcijalni leak) | ✔ | ✘ | ✘ | **H** |
| I-08 | Otkazivanje vraća stock tačno jednom | `cancelOrder` (local) | ✔ | ✘ (station cancel ne vraća; admin cancel u Supabase modu ne upisuje) | ✔ local | H |
| I-09 | Refund samo iz `cancelled` | `refundOrder` | ✔ | ✘ | ✘ | M |
| I-10 | Sto `occupied` dok ima aktivnih narudžbi; `available` kad nema | Implicitno: checkout postavlja occupied; oslobađanje ručno (Orders, ServiceStation) | djelimično | checkout postavlja occupied; ništa ne oslobađa | ✔ (`marks table occupied`) | M |
| I-11 | Samo pravi (UUID) stolovi mijenjaju status; keyword `takeaway/delivery/walk-in` ne | store regex (Supabase grana), SQL regex | ✔ | ✔ | ✘ | L |
| I-12 | `table_id` za dine-in pripada tenantu | SQL lookup scope-ovan na `user_id` | — | ✔ (inače ime = sirovi string) | ✘ | M |
| I-13 | Rezervacija ističe poslije 5 min (TTL) | `RESERVATION_TTL_MS` store; SQL `expires_at > now()` | ✔ | ✔ za DB redove — koji za anon kupce **ne postoje** | ✔ local | M |
| I-14 | Dvije sesije ne mogu kupiti isti posljednji komad | reservations (local), `FOR UPDATE` (server) | ✔ | ✔ `FOR UPDATE` na menu_items + settings lock | ✔ local | L (server OK) |
| I-15 | Order number jedinstven i monoton po tenantu | SQL: lock settings reda + increment | local counter | ✔ logički, ✘ nema UNIQUE constraint-a; owner upsert može resetovati brojač | ✔ local (`increments orderNumber`) | M |
| I-16 | Receipt je nepromjenljiv snapshot narudžbe | komentar u 001 | — | ✘ owner može UPDATE (RLS ALL) | ✘ | L |
| I-17 | Scheduled order: `scheduled_for` je budućnost, ≥ now+30 min, u radnom vremenu, format `YYYY-MM-DD HH:MM` | OrderPortal slot generator | ✔ (samo portal put) | ✘ | ✘ | H |
| I-18 | Scheduled samo za takeaway/delivery | Menu (`orderMode !== 'dine-in'`) | ✔ | ✘ | ✘ | L |
| I-19 | Narudžba samo u radno vrijeme (timezone restorana) | `OrderPortal.checkOpenStatus` (timezone uređaja) | djelimično | ✘ | ✘ | **H** |
| I-20 | Narudžba samo kad `orderingPaused = false` | OrderPortal, ModeSelector; SQL | djelimično (dine-in QR ne) | ✔ | ✘ | L |
| I-21 | Takeaway/delivery samo kad je kanal uključen | OrderPortal, Menu | ✔ | ✘ | ✘ | M |
| I-22 | Delivery zahtijeva adresu; takeaway/delivery zahtijevaju ime+telefon | Menu `customerInfoValid` | ✔ | ✘ | ✘ | M |
| I-23 | Booking: status `pending` kad `requireApproval`, inače `approved` | BookingPage | ✔ | ✘ (klijent bira) | ✘ | **H** |
| I-24 | Booking type od kupca ∈ {reservation, private_event} | BookingPage | ✔ | ✘ (closure dozvoljen) | ✘ | **H** |
| I-25 | Booking datum ≥ danas, ≤ `advanceBookingDays`, radni dan, nije izuzetak/closure | BookingPage `isAvailableDay` | ✔ (UTC bug) | ✘ | ✘ | H |
| I-26 | Booking ≤ `maxEventsPerDay` | BookingPage | ✔ | ✘ | ✘ | M |
| I-27 | Guests unutar paketa `[min,max]`, > 0 | nigdje (samo `>=1` u UI) | djelimično | ✘ | ✘ | M |
| I-28 | Samo menadžer odobrava/odbija | Admin UI + owner RLS | ✔ | ✔ za UPDATE; ✘ za INSERT (anon insert `approved`) | ✘ | H |
| I-29 | Stanica može izvršiti akciju samo ako permission to dozvoljava | Station UI komponente | ✔ | ✘ | ✘ | **H** |
| I-30 | Pristup stanici samo uz PIN | StationGate (client) | ✔ | ✘ | ✘ | **H** |
| I-31 | Prep time adjustment ∈ [-60, 180] | store `adjustPrepTime` | ✔ | ✘ (station RPC bez granica) | ✘ | L |
| I-32 | Tenant izolacija čitanja | RLS owner + RPC scope | — | ✔, osim `orders`/`tables` anon policy | ✔ local-only test (`two accounts do not share`) — ne testira RLS | **H** |
| I-33 | Settings red postoji za svakog korisnika i ima `restaurant_token` | hydration kreira ako fali | ✔ | UNIQUE(user_id), UNIQUE(token), NOT NULL | ✘ | L |
| I-34 | Menu item `price >= 0`, `prep_time >= 0`, `max_stock >= 0` | MenuManager forma (UNKNOWN koliko strogo) | ? | ✘ | ✘ | L |
| I-35 | Kitchen event pripada narudžbi istog tenanta | — | — | ✘ (`order_id text`, bez FK/provjere) | ✘ | L |
| I-36 | Smjena referencira postojeće zaposlene | `deleteEmployee` čisti lokalno | ✔ local | ✘ | ✘ | L |
| I-37 | Svaki perzistirani workspace sadrži sve slice-ove (nema gubitka pri refresh-u) | `_persistLocal` + `_rehydrateLocal` | ✘ (BUG-03) | n/a | ✘ (test "login after logout restores" ne pokriva refresh preko AuthProvider-a) | **H** |

## Pravila koja postoje SAMO u React/UI sloju

I-06 (većim dijelom), I-17, I-18, I-19, I-21, I-22, I-23, I-24, I-25, I-26, I-27, I-29, I-30, kao i pravilo oslobađanja stola iz I-10.
Pravila koja postoje i u store-u, ali ne i na serveru: I-01, I-04, I-08 (Supabase), I-09, I-31.

Najopasnija kombinacija: I-04 + I-05 + I-07 (finansijski integritet) i I-29 + I-30 + I-32 (autorizacija).
