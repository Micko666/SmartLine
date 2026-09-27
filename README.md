# SmartLine

Restaurant operations platform: customer ordering (dine-in QR, takeaway, delivery), kitchen/bar/service station screens, orders, menu, stock, tables and floor map, bookings, staff roster and analytics.

React 18 · TypeScript (strict) · Vite · Zustand · Supabase (Postgres, Auth, RPC, Realtime, Storage) · Tailwind + shadcn/ui · Vitest · Playwright.

## Quick start

```bash
npm ci
npm run dev            # http://localhost:8080
```

Without Supabase variables the app runs in **local/demo mode** (data in this browser's localStorage). Sign in with `demo@smartline.io` / `demo1234`.

### Environment

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL. When set, the app runs in Supabase mode. |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (publishable) key. |
| `PW_CHANNEL` | Optional, E2E only: `chrome` reuses an installed Google Chrome instead of Playwright's Chromium. |

Copy `.env.example` to `.env` for Supabase mode. `.env` is git-ignored.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :8080 |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript (strict, no unused code); Vite's build does **not** type-check |
| `npm test` | Unit + component tests (Vitest, jsdom) |
| `npm run test:db` | Migrations + RLS/RPC security + parity + client/DB contract tests on an in-process Postgres (PGlite). No Docker needed. |
| `npm run test:e2e` | Playwright smoke tests (starts a local-mode dev server on :4173) |

First E2E run: `npx playwright install chromium`, or set `PW_CHANNEL=chrome` to use an installed Chrome.

## Two execution modes

| | Local / demo | Supabase |
|---|---|---|
| Data | localStorage (`smartline-workspace-{userId}`) | Postgres with RLS |
| Authority | shared domain rules in `src/domain` | the database: RPCs + constraints + triggers |
| Public pages (menu, portal, booking, station) | only in the browser where the owner is signed in | any device |

Both modes run the same business rules. `supabase/tests/parity.test.ts` checks that the TypeScript rules and the SQL agree.

## Architecture

```
src/domain/       pure business rules (no React, no IO)
  ordering/       cart.ts (checkout rules), orderOperations.ts (status machine + restock),
                  scheduling.ts (hours/slots), orderMerge.ts
  booking/        policy.ts (availability + booking validation)
  time/           restaurantTime.ts (restaurant timezone, DST, overnight hours)
  orderMachine.ts, stations.ts, types.ts
src/services/     IO: workspaceService (owner RPCs), stationService, bookingService
src/store/        Zustand: types.ts, runtime.ts, slices/*, workspace.ts (local serializer),
                  hydration.ts (Supabase load), bridge.ts (plain CRUD writes)
src/lib/supabase/ client, row mappers, queries, realtime hooks
src/pages/        routes (customer/, admin/, station/) split into per-component folders
supabase/         migrations/ (001–023), tests/ (PGlite harness), preflight/, config.toml
e2e/              Playwright smoke tests
docs/             stabilization audit + execution report
```

Rules of thumb:
- The server is authoritative for money, stock, order status, bookings and station permissions; browser checks are for UX only.
- Business rules go in `src/domain` and get unit tests. When a rule exists in SQL too, add a parity scenario.
- UI never writes to the store with `setState`; it calls store actions, which call services.

## Routes

| Route | Surface |
|---|---|
| `/`, `/signup` | Owner login / signup |
| `/dashboard`, `/orders`, `/menu-manager`, `/inventory`, `/tables`, `/prep-times`, `/analytics`, `/ingredients`, `/settings`, `/stations`, `/calendar` | Admin (signed-in owner) |
| `/menu?t={tableId}&r={token}` | Dine-in (table QR) |
| `/order/{token}` | Takeaway / delivery: pick a time, then `/menu?mode=…&date=…&time=…&r=…` |
| `/receipt/{id}` | Receipt with "Order More" |
| `/track?r={token}&n={orderNumber}` | Order status (not linked in the UI yet) |
| `/book/{token}` | Booking request, confirmation code, status lookup |
| `/roster/{token}` | Staff roster (names, roles, next 4 weeks of shifts) |
| `/station/{token}/{stationId}` | Station device (PIN → server session) |

## Supabase

- Migrations live in `supabase/migrations/` and are numbered. Every change is a new file; applied files are never edited.
- Before shipping a migration: `npm run test:db` must pass, including the production-parity test.
- Production history uses different version ids than the repository. **Do not use `supabase db push` on production.** Follow the runbook in `docs/stabilization-execution.md` (preflight → backup → apply files in order → deploy frontend → re-run advisors).
- Local stack, if you have Docker and the Supabase CLI: `supabase start` then `supabase db reset` (config in `supabase/config.toml`).

## CI

`.github/workflows/ci.yml`: `npm ci → lint → typecheck → test → test:db → build`, then Playwright smoke.

## Documentation

- `docs/stabilization-audit/`: the audit that started the stabilization
- `docs/stabilization-execution.md`: what changed, why, how to deploy, what is left
- `CLAUDE.md`: working notes for AI-assisted development
