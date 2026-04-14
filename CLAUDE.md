# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:8080
npm run build        # Production build
npm run build:dev    # Development build
npm run preview      # Preview production build
npm run lint         # Run ESLint
npm run test         # Run Vitest once
npm run test:watch   # Run Vitest in watch mode
```

Demo login: `demo@smartline.io` / `demo1234`

## Architecture

**SmartLine** is a restaurant operations platform (React + TypeScript + Vite) with a fully unified Zustand store. There is no backend — all data is persisted to `localStorage` via Zustand's `persist` middleware under the key `smartline-v1`.

### Single source of truth

Every page reads from and writes to `src/store/index.ts`. There is **no local state for business data** — menu items, orders, tables, stock, settings, and receipts all live in the store. Replacing localStorage with an API later means swapping the Zustand `storage` adapter only.

### Domain layer (`src/domain/`)

| File | Purpose |
|------|---------|
| `types.ts` | All TypeScript interfaces (`MenuItem`, `Order`, `Table`, `Receipt`, `CartItem`, `StockReservation`, `BusinessSettings`, …) |
| `orderMachine.ts` | Valid order status transitions, `advance()`, `canTransition()`, status labels/CSS. Status flow: `paid → preparing → ready → served → completed` (also `cancelled → refunded`) |
| `initialData.ts` | Seed menu items, seed tables, default settings, demo user |

### Store (`src/store/index.ts`)

Key actions:
- `checkout(payload)` — atomic: validates stock, checks reservations, deducts stock, creates `Order` + `Receipt`, marks table occupied, increments order number
- `validateCart(cart)` — non-destructive pre-check; returns issues list
- `createReservation(sessionId, cart)` — holds stock for 5 min during payment; blocks concurrent oversell
- `releaseReservation(sessionId)` — frees reserved stock on abandon/checkout
- `cancelOrder(orderId)` — restores stock, marks table available
- `advanceOrderStatus(orderId)` — uses `orderMachine.advance()` for safe transitions
- `adjustPrepTime(orderId, delta)` — manual kitchen adjustment (minutes)

### Routing (`src/App.tsx`)

| Route | Surface | Auth |
|-------|---------|------|
| `/` | Login | Public |
| `/signup` | Signup | Public |
| `/menu?t={tableId}` | Customer menu | Public |
| `/receipt/{receiptId}` | Post-payment receipt | Public |
| `/dashboard` | Dashboard | `AdminGuard` |
| `/orders` | Order management | `AdminGuard` |
| `/menu-manager` | Menu CRUD | `AdminGuard` |
| `/inventory` | Stock management | `AdminGuard` |
| `/tables` | Tables + QR codes | `AdminGuard` |
| `/prep-times` | Kitchen timing | `AdminGuard` |
| `/analytics` | Charts | `AdminGuard` |
| `/settings` | Business settings | `AdminGuard` |

`AdminGuard` (`src/components/admin/AdminGuard.tsx`) redirects unauthenticated users to `/` and preserves the `from` location for post-login redirect.

### Customer flow

1. Manager creates tables in `/tables`, each gets a QR code for `{origin}/menu?t={tableId}`
2. Customer scans QR → opens `/menu?t={tableId}` (mobile-first, no admin UI)
3. Browse → add to cart → checkout → payment sheet → `store.checkout()` runs atomically
4. If stock conflict at payment time: unavailable items are listed, cart is revalidated, customer must review before retrying
5. On success: redirected to `/receipt/{receiptId}` showing full receipt
6. Admin sees new `paid` order instantly in `/orders` and `/dashboard`

### Stock rules

- `stock: null` = unlimited (no deduction, no reservation needed)
- `stock: number` = tracked; deducted at checkout; restored on `cancelOrder`
- `settings.lowStockThreshold` = badge threshold (default 5)
- `settings.zeroStockBehavior`: `'hide'` removes item from customer menu; `'disable'` greys it out
- Reservations expire after 5 min; purged on store rehydration

### Auth

Login credentials are checked against the demo account and a `smartline-accounts` array in localStorage (separate from the main store). `signup()` writes to this array. The structure is ready for real API: replace the `login`/`signup` store actions with API calls.

### Images

`MenuItem` has `imageUrl` (full food photo) and `thumbnailUrl` (small icon), both stored as base64 data-URLs when uploaded via the file picker in MenuManager. Emoji `icon` is always the fallback.

### Tests (`src/tests/`)

- `orderMachine.test.ts` — state machine transitions, advance logic, terminal states
- `store.test.ts` — checkout, stock deduction, oversell prevention, cancel/restore, table management, settings, cart validation, getAvailableStock

All tests use `useStore.setState()` to reset to a clean fixture before each test — no mocking needed.

### UI components

`src/components/ui/` — shadcn/ui primitives (do not edit directly, extend by composition). Path alias `@/` → `src/`. Tailwind CSS with HSL CSS variables in `src/index.css`. Primary color: teal `hsl(160, 84%, 29%)`. Fonts: Inter (body), Space Grotesk (headings).
