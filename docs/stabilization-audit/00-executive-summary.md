# 00 — Executive summary: SmartLine stabilization audit

> **Historical snapshot (2026-09-27, before remediation).** Most findings below were fixed on branch `stabilization/astra`; current status, remaining blockers and the deployment runbook are in [`docs/stabilization-execution.md`](../stabilization-execution.md).

**Datum:** 2026-09-27 · **Obim:** cijeli repo + read-only pregled povezanog Supabase projekta `SmartLine` (`bcwlizkhceidumyaygda`) · **Izmjene koda:** nijedne (dodat je samo `docs/stabilization-audit/`; `npm install` je kreirao `node_modules`).

## Stanje u jednoj rečenici
Aplikacija se builduje i testovi prolaze, ali build ne provjerava tipove, testovi pokrivaju samo lokalni (demo) mod, glavni takeaway/delivery tok trenutno pada, a produkciona baza izlaže narudžbe sa ličnim podacima kupaca anonimnim korisnicima i vjeruje klijentu za cijene, količine, statuse i autorizaciju stanica.

## Brojevi
| Metrika | Vrijednost |
|---|---|
| Testovi | 91/91 prolazi (samo local mode) |
| ESLint | 0 errors / 8 warnings |
| `tsc -p tsconfig.app.json` | **11 grešaka** (`npx tsc --noEmit` je lažno zelen) |
| `vite build` | prolazi (ne radi type-check) |
| Playwright | pokvaren (nedostaje `lovable-agent-playwright-config`), 0 E2E testova |
| Migracije lokalno / remote | 14 / 29 → **16 remote migracija nije u repou** |
| Public SECURITY DEFINER RPC-ovi | 13 (anon-izvršivi), 7 bez `search_path` |
| Najveći fajlovi | Calendar 1940, Tables 1732, Menu 1539, store 1499 linija |

## Top nalazi (sve CONFIRMED osim gdje je naznačeno)

### P0 — odmah
1. **Takeaway/delivery ne radi.** `OrderPortal.tsx:209` referencira nepostojeći `noSlotsToday` → `ReferenceError` i prazan ekran čim se izabere kanal. Runtime reprodukovano. (02 §3.1)
2. **Anon čita sve narudžbe svih restorana.** Migracija 014 dodaje `SELECT … TO anon USING (true)` na `orders` i `tables`. Kao `anon` je vidljivo 139 narudžbi, a `notes` sadrži ime, telefon i adresu delivery kupaca. (06 SEC-01)
3. **Checkout vjeruje klijentu.** `atomic_checkout` ne provjerava znak količine (negativna qty povećava stock i daje negativan total), a cijenu modifiera uzima iz klijentskog JSON-a. (06 SEC-02)
4. **Stanice nemaju serversku autentikaciju.** `station_*` RPC traže samo `restaurant_token` (štampan na QR kodu stola). PIN je plaintext i vraća se svakom kupcu kroz `get_customer_menu`. `station_advance_order` upisuje proizvoljan status. (07)
5. **Gubitak podataka u local modu.** Refresh + bilo koja akcija briše sastojke, kalendar, zaposlene, smjene i stanice iz localStorage. Runtime reprodukovano. (02 §3.2, 03 §3.9)
6. **Stanice se brišu u Supabase modu.** Poslije refresh-a `stations` je prazan, pa `addStation` upisuje niz sa samo novom stanicom. (03 BUG-04)

### P1
7. `submit_booking` prihvata `status` i `type` od klijenta → samo-odobrene rezervacije i "closure" DoS kalendara. (09)
8. `get_roster_data` javno vraća telefon i email zaposlenih. (06 SEC-06)
9. **Migrations folder ne reprodukuje produkciju**: tabele `ingredients`, `kitchen_events`, `map_decorations` i sve station funkcije postoje samo remote; `003` nije izvršiv na svježoj bazi; `001` nije u remote istoriji. (05 §1, §5)
10. `atomic_checkout` trajno umanjuje stock ranijih stavki kad je kasnija stavka nedostupna (PL/pgSQL `RETURN` ne radi rollback). (08)
11. Local i Supabase putevi se razlikuju u pause provjeri, cancel/stock-u, remake smjeru, table statusu sa stanice i hydration-u; **testirani su samo local putevi**. (03 §3.7)
12. Datumi se računaju u UTC-u (`toISOString().slice(0,10)`) na ~10 mjesta; `settings.timezone` se ne koristi. (08)
13. Realtime za kupčev meni ne radi (nema anon policy na `menu_items` od 009); admin `onVisible` merge gubi narudžbe koje su završene dok je tab bio skriven. (01 §7, 03 R4)

## Šta NIJE problem (potvrđeno)
- Osnovna cijena artikla, porez i total se računaju server-side; tenant scope u RPC-ovima je ispravan (menu item i sto drugog tenanta se ne mogu koristiti).
- Serijalizacija checkout-a (`FOR UPDATE` na settings i menu_items) sprečava overselling posljednjeg komada.
- Owner RLS (`auth.uid() = user_id`) je ispravna na svim tabelama; `receipts` i `business_settings` nisu anon-čitljivi.
- `get_receipt_by_id` i `get_order_status` ne vraćaju PII.
- Storage policies za `menu-images` su ispravno scope-ovane po `auth.uid()` folderu.

## UNKNOWN (nije moguće potvrditi u ovom auditu)
- Koji lock fajl/package manager koristi Vercel build.
- Da li je `atomic_checkout` tijelo na remote-u identično migraciji 013 znak-po-znak (provjereni su samo ključni izrazi).
- Sadržaj remote verzije `shift_assignments` (lokalni 003 nije izvršiv).
- Ponašanje `signup` kada je Supabase email confirmation uključen.
- Platformski rate limiti Supabase-a za anon RPC.
- Stvarni double-submit u checkout-u (dugme se disable-uje preko state-a; race je teorijski moguć — PLAUSIBLE).

## Preporuka
Pratiti `12-refactor-plan.md` → **TOP 20** redom. Prvih 5 koraka (git, typecheck, `noSlotsToday`, dva hydration baga) su mali, lokalni i odmah smanjuju štetu. Sigurnosni koraci 8–13 zahtijevaju prvo **baseline šeme (6)** i **DB test harness (7)**, jer se bez njih migracije primjenjuju naslijepo na bazu koja se razlikuje od repoa.

## Mapa dokumenata
| Fajl | Sadržaj |
|---|---|
| 01-architecture-map.md | Rute, auth, store, persistence, realtime, tokovi po podsistemu, local vs Supabase |
| 02-runtime-health.md | Rezultati komandi, TS greške, runtime reprodukcije, Playwright, lock fajlovi |
| 03-store-audit.md | Tabela svih akcija, atomičnost, rollback, race conditions, parity, granice modula |
| 04-domain-invariants.md | 37 invarijanti: client/server/test/rizik |
| 05-supabase-schema.md | Efektivna šema, drift vs remote, RLS, publikacije, RPC inventory |
| 06-security-audit.md | Trust boundary, SEC-01…17 |
| 07-station-audit.md | PIN, sesija, RPC, permissions, preporučeni model |
| 08-ordering-audit.md | Takeaway/delivery/dine-in tokovi, edge case-ovi, data exposure po RPC-u |
| 09-booking-audit.md | Booking tok i nalazi BK-01…18 |
| 10-test-coverage.md | Matrica pokrivenosti i testovi koji nedostaju |
| 11-tech-debt.md | Dead code, zastarjela dokumentacija, duplikati, coupling, veličine fajlova |
| 12-refactor-plan.md | Faze 0–5 i TOP 20 u dependency redoslijedu |
