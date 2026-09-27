# 02 — Runtime health

Audit datum: 2026-09-27. Okruženje: Windows 11, Node v22.20.0, npm 10.9.3.
Legenda: **CONFIRMED** = potvrđeno komandom ili čitanjem koda; **PLAUSIBLE** = vrlo vjerovatno, nije runtime dokazano; **UNKNOWN** = nije moguće potvrditi.

## 1. Rezultati komandi

| Komanda | Exit | Rezultat |
|---|---|---|
| `npm install` | 0 | `up to date` (node_modules je instaliran u ovoj sesiji; prije audita nije postojao) |
| `npm run lint` | 0 | 0 errors, 8 warnings |
| `npm test` (`vitest run`) | 0 | 4 fajla, **91/91 testova prolazi** |
| `npx tsc --noEmit` | 0 | **Lažno zeleno — ne provjerava ništa** (vidi 2.1) |
| `npx tsc --noEmit -p tsconfig.app.json` | 2 | **11 TypeScript grešaka** |
| `npx tsc --noEmit -p tsconfig.node.json` | 0 | OK (samo `vite.config.ts`) |
| `npm run build` (`vite build`) | 0 | Build prolazi za ~25 s, najveći chunk `index-*.js` 387 KB (119 KB gzip), `AreaChart-*.js` 378 KB |
| `npx playwright test --list` | ≠0 | `ERR_MODULE_NOT_FOUND: lovable-agent-playwright-config` |

### 2.1 `npx tsc --noEmit` je lažno zelen — CONFIRMED
`tsconfig.json` ima `"files": []` i samo `references`. Bez `-b` (build mode) `tsc` ne prati reference i ne kompajlira nijedan fajl → uvijek exit 0.
Ispravna provjera je `npx tsc -b` ili `npx tsc --noEmit -p tsconfig.app.json`. U `package.json` **ne postoji** `typecheck` skripta; CI (ako postoji) ne bi uhvatio greške.

### 2.2 `vite build` prolazi uprkos TS greškama — CONFIRMED
Vite (`@vitejs/plugin-react-swc`) samo transpilira, ne radi type-check. Build je prošao (exit 0) iako `tsc -p tsconfig.app.json` prijavljuje 11 grešaka, uključujući jednu koja ruši runtime (`noSlotsToday`).

### 2.3 TypeScript greške (tsconfig.app.json)

| # | Fajl:linija | Greška | Klasifikacija |
|---|---|---|---|
| 1 | `src/components/floor/FloorMapCanvas.tsx:31` | `Cannot find name 'TableShape'` | Nedostaje `import type`. Samo type-level — runtime OK. |
| 2 | `src/components/floor/FloorMapCanvas.tsx:413` | `Cannot find name 'TableStatus'` | Isto. |
| 3 | `src/pages/admin/Orders.tsx:558` | lucide ikona ne prima `title` prop | Kozmetika; `title` se ignoriše. |
| 4 | `src/pages/customer/Menu.tsx:418` | `unavailableItems` na `CheckoutResult` | Posljedica `strict:false`/`strictNullChecks:false` — discriminated union se ne sužava. Runtime OK. |
| 5 | `src/pages/customer/Menu.tsx:424` | `error` na `CheckoutResult` | Isto. |
| 6 | **`src/pages/customer/OrderPortal.tsx:209`** | **`Cannot find name 'noSlotsToday'`** | **RUNTIME CRASH — vidi 3.1** |
| 7 | `src/pages/customer/OrderPortal.tsx:330` | `reason` na union tipu | Isto kao #4. Runtime OK. |
| 8 | `src/store/hydration.ts:86` | `defaultCalendarSettings` nema `shiftTemplates`, `weekTemplate` | Stvarni nedostatak: Supabase korisnik bez `calendar_settings` dobija objekat bez ta dva polja. `applyWeekTemplate` koristi `?? []`, ali ostali potrošači — UNKNOWN. |
| 9 | `src/tests/store.test.ts:52` | fixture `Table` bez `shape` | Zastario test fixture. |
| 10 | `src/tests/store.test.ts:56` | fixture `BusinessSettings` bez 5 obaveznih polja | Zastario test fixture. |
| 11 | `src/tests/store.test.ts:211` | isto kao #4 | — |

Kompajlerske opcije koje sakrivaju probleme: `strict: false`, `strictNullChecks: false`, `noImplicitAny: false`, `noUnusedLocals: false` (`tsconfig.app.json`). ESLint ima `@typescript-eslint/no-unused-vars: "off"` (`eslint.config.js`).

### 2.4 Lint upozorenja (8)
- `AuthProvider.tsx:90`, `Menu.tsx:174` — nepotrebni `eslint-disable` direktivi.
- `useStationOrders.ts:97` — `useEffect` nedostaje dependency `restaurantToken` (kanal se ne re-subscribe-uje ako se token promijeni; praktično nizak rizik jer se token ne mijenja u toku sesije).
- 5× `react-refresh/only-export-components` u `src/components/ui/*` (shadcn — ignorisati).

## 3. Runtime provjera ključnih bagova (dev server, lokalni demo mode)

Server je pokrenut sa `npx vite --port 8080`, login `demo@smartline.io`, zatim ugašen. Nijedan source fajl nije mijenjan; promijenjeni su samo demo podaci u localStorage izolovanog browser panela.

### 3.1 `noSlotsToday` — CONFIRMED runtime crash
- Kod: `src/pages/customer/OrderPortal.tsx:209` → `{isToday && !noSlotsToday && (`. Promjenljiva ne postoji; lokalna varijabla se zove `noSlots` (linija 148).
- `ScheduleStep` inicijalizuje `date = today` (linija 136), pa je `isToday === true` pri **svakom** prvom renderu.
- Reprodukcija: `/order/demo` → klik "Takeaway" → **prazan ekran**, konzola:
  `Uncaught ReferenceError: noSlotsToday is not defined at ScheduleStep (OrderPortal.tsx)`.
- Posljedica: **takeaway i delivery tok kroz portal su potpuno neupotrebljivi.** Nema React Error Boundary-ja, pa pada cijelo stablo.
- Napomena: `/order/demo` je nedjeljom prikazivao "We're closed on Sundays" (`checkOpenStatus`). Da bi se došlo do koraka zakazivanja, nedjelja je privremeno otvorena u Settings.

### 3.2 Gubitak podataka poslije refresh-a u local modu — CONFIRMED runtime
- Demo seed ima 10 sastojaka (`SEED_INGREDIENTS`, `src/domain/initialData.ts:81`).
- Tok: login → full page navigation (refresh) → `AuthProvider._rehydrateLocal()` (`src/components/providers/AuthProvider.tsx:96`) vraća samo `menuItems, categories, tables, orders, receipts, settings, nextOrderNumber, reservations`. `ingredients`, `kitchenEvents`, `decorations`, `calendarEvents`, `eventPackages`, `employees`, `shifts` i top-level `stations` ostaju prazni iz inicijalnog store-a.
- Prva store akcija (ovdje "Save All Changes" u Settings) poziva `_persistLocal` (`src/store/index.ts:1437`), koji upisuje **cijeli** snapshot → localStorage `smartline-workspace-user-demo` ima `ingredients: 0`.
- Isto važi za `settings.stations`: `_persistLocal` radi `{...settings, stations}` sa praznim top-level `stations` → **stanice se brišu**.

## 4. Playwright — CONFIRMED broken
- `playwright.config.ts` importuje `lovable-agent-playwright-config/config`; `playwright-fixture.ts` importuje `lovable-agent-playwright-config/fixture`.
- Paket **ne postoji** u `package.json`, `package-lock.json`, `bun.lock` ni u `node_modules`.
- `npx playwright test --list` → `ERR_MODULE_NOT_FOUND`. `@playwright/test` 1.58.2 je instaliran, ali **nema nijednog E2E testa** u repou (nema `*.spec.ts` van `src`).
- Zaključak: Playwright je ostatak Lovable šablona; E2E infrastruktura ne postoji.

## 5. Konzistentnost dependency tree-a

| Lock fajl | Stanje |
|---|---|
| `package-lock.json` (lockfileVersion 3) | **Konzistentan** sa `package.json` (0 razlika u root dependencies — provjereno skriptom). `npm install` → "up to date". |
| `bun.lock` | **Zastario.** Nedostaju `@supabase/supabase-js`, `zustand`, `react-qr-code`; sadrži `lovable-tagger` koji više nije u `package.json`. URL-ovi pokazuju na `lovable-core-prod` npm cache. |
| `bun.lockb` | Binarni, vjerovatno isto zastario (UNKNOWN — nije dekodiran). |

Rizik: Vercel (i drugi hostovi) biraju package manager po prisustvu lock fajla. Ako se izabere `bun`, instalacija može odstupiti od `package-lock.json`. Koji lock Vercel stvarno koristi — **UNKNOWN** (build log nije dostupan). `vercel.json` sadrži samo SPA rewrite.

Instalirane verzije: vite 5.4.19, vitest 3.2.4, react 18.3.1, typescript 5.8.3, zustand 5.0.12, @supabase/supabase-js 2.100.1.

## 6. Ostale okolinske činjenice
- Folder **nije git repozitorijum** → nema istorije ni mogućnosti bezbjednog revert-a refaktoringa. `PROJECT_NOTES.md` citira commit hash-eve koji ovdje ne postoje.
- Nema `.env` → lokalno aplikacija radi samo u local/demo modu. `.env.example` postoji.
- `.gitignore` tri puta sadrži `.vercel` (kozmetika).
- `run-smartline.bat` ubija svaki proces na portu 8080 (agresivno, ali lokalno).
- Test okruženje (`vitest.config.ts`) forsira `VITE_SUPABASE_URL=''` → **svi testovi pokrivaju samo local mode**; Supabase grane nisu testirane nijednim testom.
