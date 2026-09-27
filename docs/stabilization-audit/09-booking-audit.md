# 09 — Booking audit

## 1. Tok

```text
/book/:restaurantToken                                   BookingPage.tsx:83
 load (:120-190):
   res = rpc get_customer_menu(token)   (samo za ime restorana; povlači cijeli meni + PIN-ove)
         fallback: store.settings ako token odgovara
   isLocal = !Supabase || store.settings.restaurantToken === token   (:136)
   Local:    calendarSettings/eventPackages/calendarEvents iz store-a (uklj. customerPhone/Name)
   Supabase: rpc get_booking_data(token) → settings, aktivni paketi, eventi {id,date,time_slot,type,status}
             (default CalendarSettings hardkodovan u komponenti :151-164)
 UI: [packages] → date (isAvailableDay :200-218) → slot (buildTimeSlots 60 min :220-229) → forma
 submit (:249-285):
   status = calendarSettings.requireApproval ? 'pending' : 'approved'      ← odluka na KLIJENTU
   type   = packageId ? 'private_event' : 'reservation'
   Local:    store.addCalendarEvent(eventData)   (surgical localStorage write ako store nije hidratisan, store/index.ts:1057-1083)
   Supabase: rpc submit_booking(token, …, p_status, p_type, …)
 lookup po telefonu (:232-247)
Admin: Calendar.tsx → approveCalendarEvent / rejectCalendarEvent (store) → bridge UPDATE (owner RLS)
Realtime: calendar_events INSERT/UPDATE → useRealtimeCoordinator (publikacija = DRIFT, 05 §4)
```

## 2. Nalazi

| ID | Tema | Nalaz | Status |
|---|---|---|---|
| BK-01 | `requireApproval` | Odluku donosi klijent (`BookingPage.tsx:252`); server upisuje `p_status` bez provjere (`011:269`). | CONFIRMED |
| BK-02 | Anon šalje `approved` | **DA.** Direktan RPC poziv sa `p_status='approved'` → odobrena rezervacija bez menadžera. Čak i `completed`/`cancelled`/`rejected` su dozvoljeni (CHECK). | CONFIRMED |
| BK-03 | Anon šalje `type='closure'` | **DA.** CHECK dozvoljava; `approved` closure blokira dan u `isAvailableDay` (`:217`) za sve kupce i pojavljuje se u adminu kao zatvaranje. | CONFIRMED |
| BK-04 | Validacija datuma | Samo client: `>= today` (UTC, vidi 08), `<= today + advanceBookingDays`, radni dan, izuzeci. Server: **ništa** (tekst, bez formata). | CONFIRMED |
| BK-05 | Validacija vremena | Client: 60-min slotovi između open/close (poslednji slot = close − 60). Ne isključuje prošla vremena za danas. Server: ništa. | CONFIRMED |
| BK-06 | Phone lookup | **Local**: radi (store ima `customerPhone`). **Supabase**: `get_booking_data` ne vraća telefon → `runLookup` filtrira po `customerPhone ?? ''` → nalazi samo rezervaciju upravo poslatu u ovoj sesiji (ubačenu lokalno, `:264-273`, sa **izmišljenim `crypto.randomUUID()` id-jem**, ne pravim `eventId`). Poslije refresh-a lookup uvijek vraća prazno. | CONFIRMED |
| BK-07 | Status badge | `StatusBadge` provjerava `'declined'` (`:52`), a domen koristi `'rejected'` → odbijena rezervacija se kupcu prikazuje kao **"⏳ Pending"**. Isto za `cancelled`/`completed`. | CONFIRMED |
| BK-08 | Max events/day | Client-only (`:213-216`, broji `approved`+`pending`). Server ne broji; paralelni zahtjevi prolaze preko limita. Admin-kreirani eventi takođe ne provjeravaju limit (UNKNOWN za Calendar.tsx formu). | CONFIRMED (client/server dio) |
| BK-09 | Closures | Client provjerava `type==='closure' && status==='approved'`. `workingExceptions.isClosed` se poštuje. Server ne provjerava ni jedno. | CONFIRMED |
| BK-10 | Event package validacija | Server ne provjerava da `package_id` postoji, da je aktivan ni da pripada tenantu (`package_id` je `text` bez FK). `package_name` dolazi od klijenta → proizvoljan naziv. | CONFIRMED |
| BK-11 | Guest limit | UI: `Math.max(1, guests-1)`, gornja granica ne postoji (`:604-607`). Paketi `minGuests/maxGuests` se samo prikazuju (`:467`), ne enforce-uju. Server: `COALESCE(p_guest_count,1)`, bez CHECK-a (0, negativno, ogromno prolazi). | CONFIRMED |
| BK-12 | Day-of-week bug | `new Date('YYYY-MM-DD').getDay()` (`:211`, `:222`) parsira kao **UTC ponoć** → u zonama zapadno od UTC dan u sedmici je pomjeren za −1. U Evropi (UTC+) radi slučajno ispravno. | CONFIRMED statički |
| BK-13 | Default settings duplikat | Isti default `CalendarSettings` postoji 3 puta: `store/index.ts:29-48`, `hydration.ts:86-101` (bez `shiftTemplates/weekTemplate` → TS greška), `BookingPage.tsx:151-164`. Sunday open/close se razlikuje (09–22 vs 10–20). | CONFIRMED |
| BK-14 | `get_customer_menu` za ime | Booking stranica poziva cijeli meni RPC (sa PIN-ovima stanica) samo da bi dobila `businessName`. | CONFIRMED |
| BK-15 | Double submit | `handleSubmit` nema loading guard; submit dugme (`BookingPage.tsx:624`) nema `disabled` tokom slanja; server nema dedup → višestruki klik = duplikati. Neuspjeh (`ok=false`) se tiho ignoriše — nema poruke o grešci. | CONFIRMED |
| BK-16 | Local mode "public" booking | Radi samo u istom browseru gdje je admin (store/`_activeUserId`). `addCalendarEvent` sa nehidratisanim store-om radi surgical write (dobro), ali poziva i bridge ako postoji `user`. | CONFIRMED |
| BK-17 | Email/telefon format | Bez validacije (client i server). | CONFIRMED |
| BK-18 | Kalendarski prikaz | `firstDay`/`daysInMonth` koriste lokalno vrijeme, a `todayStr` UTC → mješavina. | CONFIRMED |

## 3. Local vs Supabase razlike

| Aspekt | Local | Supabase |
|---|---|---|
| Izvor eventova | cijeli store (sa PII) | lean (bez PII) |
| Lookup po telefonu | radi | ne radi (BK-06) |
| Submit | `addCalendarEvent` (+ bridge ako je admin ulogovan) | `submit_booking` RPC |
| Real-time status update za kupca | `storage` event cross-tab (`store/index.ts:1449-1473`) | nema (kupac ne sluša realtime) |
| Default settings | `DEFAULT_CALENDAR_SETTINGS` store-a | lokalni `def` u komponenti |

## 4. Šta mora postati server-side (Phase 0/3)
`submit_booking` treba da ignoriše `p_status`/`p_type` od anon-a: status izvesti iz `calendar_settings.requireApproval`, a type ograničiti na `reservation | private_event`. Treba da validira datum, vrijeme, radni dan i izuzetke, `maxEventsPerDay` (uz zaključavanje), aktivnost i pripadnost paketa te guest limite (paket ili globalni max), i da ograniči dužinu polja. Za lookup: poseban RPC `lookup_bookings(token, phone)` koji vraća samo status/datum za tačno taj broj (uz rate limit), umjesto vraćanja telefona u `get_booking_data`.
