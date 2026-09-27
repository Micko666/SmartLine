# CLAUDE.md

Guidance for Claude Code sessions on this repository.

## Commands

```bash
npm run dev          # Dev server at http://localhost:8080
npm run build        # Production build (does NOT type-check)
npm run lint         # ESLint
npm run typecheck    # tsc strict (+ noUnusedLocals/Parameters) — the real type gate
npm test             # Vitest unit + component (jsdom)
npm run test:db      # Migrations + RLS/RPC security + parity + client/DB contract (PGlite, no Docker)
npm run test:e2e     # Playwright smoke (PW_CHANNEL=chrome to reuse installed Chrome)
```

Demo login: `demo@smartline.io` / `demo1234`. It always uses local mode.

Git: if git reports "dubious ownership" on this folder, use `git -c safe.directory=<repo path> …` per command; don't change global config.

## Stack

React 18 + TypeScript (strict) + Vite · Zustand · Supabase (optional; `src/store/flags.ts` → `isSupabaseEnabled()`) · Tailwind + shadcn/ui · path alias `@/` → `src/`. npm is the only package manager.

## Architecture (where things go)

| Layer | Path | Rule |
|---|---|---|
| Domain | `src/domain/**` | Pure business rules, no React/IO. Unit-tested. |
| Services | `src/services/*` | Supabase RPC calls / IO (`workspaceService`, `stationService`, `bookingService`). |
| Store | `src/store/` | `types.ts` (contract), `runtime.ts`, `slices/*` (actions), `workspace.ts` (local serializer), `hydration.ts` (Supabase load), `bridge.ts` (plain CRUD writes). |
| UI | `src/pages/**`, `src/components/**` | Calls store actions. Never `useStore.setState` outside the store. |
| DB | `supabase/migrations/*` | Authoritative for money, stock, order status, bookings and station permissions. |

Key domain modules: `ordering/cart.ts` (mirror of `atomic_checkout`), `ordering/orderOperations.ts` (mirror of `transition_order_internal`), `ordering/scheduling.ts`, `booking/policy.ts` (mirror of `submit_booking`), `time/restaurantTime.ts` (restaurant timezone; never use `toISOString().slice(0,10)` for business dates), `orderMachine.ts`, `stations.ts`.

## Local vs Supabase

- Local/demo: data in `localStorage` under `smartline-auth` and `smartline-workspace-{userId}`. It is read and written only through `store/workspace.ts`, and hydration happens in one place (`hydrateWorkspace`). Public pages work only in the owner's browser.
- Supabase: RLS on every table. Public pages use SECURITY DEFINER RPCs scoped by `restaurant_token`, a receipt id or a station session.
- Same rules in both modes: when changing a rule, change the domain function **and** the SQL, and extend `supabase/tests/parity.test.ts`.

## Customer ordering flows

- **Dine-in**: table QR `/menu?t={tableId}&r={token}` → cart → place order → receipt. There is no generic dine-in picker (product decision pending).
- **Takeaway**: `/order/{token}` → Takeaway → date + 15-min slot (restaurant timezone, ≥ 30 min ahead, within business hours) → `/menu?mode=takeaway&date&time&r` → name + phone → receipt.
- **Delivery**: same plus the address. The address lives in `sessionStorage` (`lib/orderContext.ts`), **never in the URL**.
- Checkout sends only ids, quantities and modifier ids plus an idempotency key (`clientOrderId`). The server prices everything. New orders are `status='paid'` (kitchen workflow start) with `paymentStatus='unpaid'`; there is no payment provider.

## Supabase RPCs (current)

Public (anon): `atomic_checkout`, `get_customer_menu`, `get_booking_data`, `submit_booking`, `lookup_booking_status`, `get_roster_data`, `get_order_status`, `get_receipt_by_id`, `station_public_config`, `station_login`, `station_logout`, `station_get_context`, `station_get_orders`, `station_advance_order`, `station_adjust_prep_time`, `station_log_kitchen_event`, `station_set_table_status`.
Owner (authenticated): `advance_order`, `cancel_order`, `adjust_stock`, `patch_settings`, `list_stations`, `upsert_station`, `delete_station`.
The allow-list is enforced by migration 021 and by tests. A new RPC must be granted explicitly.

## Migrations

- Numbered files `NNN_name.sql`. Never edit an applied migration; add a new one.
- Each file must replay from zero in `npm run test:db` and keep `supabase/tests/migrations.test.ts` (production parity) green.
- Every SECURITY DEFINER function needs `SET search_path`, validation of all inputs, and an explicit `GRANT EXECUTE`.
- Use `gen_random_uuid()`; `crypt()`/`digest()` come from pgcrypto in the `extensions` schema.
- Production: **no `supabase db push`** (history ids differ). Follow the runbook in `docs/stabilization-execution.md`. Production is read-only for sessions unless the owner explicitly approves an apply.

## Conventions

- Keep explanations short unless teaching is requested.
- Prefer targeted edits over full-file rewrites.
- Domain first → service/SQL → store action → UI.
- Security checks belong in SQL; the browser mirrors them for UX only.
- shadcn/ui components in `src/components/ui/`: extend by composition, don't edit.
- No `any` or `@ts-ignore` to satisfy the type gate.

## Current state (Sep 2026)

- Stabilization done on branch `stabilization/astra`; see `docs/stabilization-execution.md`.
- Migrations 015–023 are **not applied to production** yet. They must be deployed together with this frontend.
- Open product decisions: generic dine-in picker, future of local/demo mode, payment provider, public roster.
- TODO: delivery address map; payment provider / "mark as paid".
