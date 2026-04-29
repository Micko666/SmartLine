# PROJECT_NOTES.md

Running log of recent changes, known issues, and task status.

---

## Session: Apr 2026 — Ordering modes + bug patch

### What was changed

#### Supabase migrations applied
| File | What it does |
|------|-------------|
| `supabase/migrations/011_uuid_generate_fix.sql` | Replace `uuid_generate_v4()` with `gen_random_uuid()` in `atomic_checkout` and `submit_booking` (SECURITY DEFINER RPCs can't see the `extensions` schema) |
| `supabase/migrations/012_ordering_modes.sql` | Add `takeaway_enabled` / `delivery_enabled` to `business_settings`; update `get_customer_menu` to expose them; fix `atomic_checkout` UUID regex guard so `takeaway`/`delivery` strings don't blow up on `::uuid` cast |

#### New features
- **Takeaway + delivery ordering** — full end-to-end: schedule step (date + 15-min time slots, 30-min minimum buffer for today) → full menu → cart → atomic checkout → receipt. No "request" or calendar approval; orders land directly in the kitchen queue.
- **Delivery address input** — text field for now; map integration deferred.
- **`BusinessSettings.takeawayEnabled` / `deliveryEnabled`** — manager toggles in Settings; disabled channels greyed out in OrderPortal.

#### Admin fixes
- **Notification badge** (`DashboardLayout`) — only counts today's active orders; previous-day orders no longer ring the bell.
- **Orders page carryover section** — previous-day orders still in `paid/preparing/ready` float to the very top with an amber "Needs attention" banner until they reach terminal state.
- **Settings portal link** — "Food Order Portal" points to `/order/:token` (OrderPortal with table picker + scheduling), not the raw menu URL.

#### Flow holes patched
- **Receipt "Order More"** — was navigating to `/menu?r=token` which triggered the old mode-selector. Now carries full `mode/date/time/addr` params.
- **Menu navigate** — now passes `date/time/addr/mode` to receipt URL.
- **ModeSelectorScreen dine-in** — previously set `?mode=dine-in` bypassing table picker; now routes to `/order/:token`.
- **Payment methods** — "Pay at Counter" hidden for delivery; renamed "Pay on Pickup" for takeaway.
- **Receipt copy** — scheduled orders show correct headline ("Ready for pickup Today at 14:30") and timing card instead of generic "estimated wait".

---

### Files touched

```
src/domain/types.ts                          — added takeawayEnabled, deliveryEnabled
src/domain/initialData.ts                    — default values for new fields
src/lib/supabase/mappers.ts                  — snake_case ↔ camelCase mapping for new fields
src/store/index.ts                           — UUID regex for table status, MODE_NAMES map
src/components/layout/DashboardLayout.tsx    — today-only notification badge
src/pages/admin/Orders.tsx                   — carryoverActive section
src/pages/admin/Settings.tsx                 — portal link fix, takeaway/delivery toggles
src/pages/customer/OrderPortal.tsx           — full rewrite: ScheduleStep replaces booking form
src/pages/customer/Menu.tsx                  — scheduling params, SchedulingStep fallback,
                                               ModeSelectorScreen dine-in fix, payment method
                                               filtering, receipt URL params
src/pages/customer/Receipt.tsx               — Order More URL fix, scheduled copy, timing card
supabase/migrations/011_uuid_generate_fix.sql
supabase/migrations/012_ordering_modes.sql
```

---

### Known issues / remaining tasks

| Priority | Task |
|----------|------|
| High | **Structured opening hours** — `openingHours` is a plain string. No automatic block on ordering outside business hours. Need per-day open/close schedule + auto-close check in OrderPortal and Menu + slot filtering. |
| Medium | **Scheduled order field** — pickup/delivery time is currently embedded in `order.notes`. Promote to a first-class `Order` field (needs migration + store + admin UI update) for cleaner kitchen display. |
| Medium | **Delivery map** — address is plain text input; map picker deferred. |
| Low | **Auth hardening** — `smartline-accounts` in localStorage; swap `login`/`signup` for real API. |

---

### Tests status

- `npm run test` — all tests pass (store + orderMachine)
- No new tests written for ordering modes yet (integration-level; covered manually)
- Run targeted: `npm test -- src/tests/store.test.ts`

---

### Git log (recent)

```
c47cb96  fix(ordering): patch holes in takeaway/delivery flow
529fc34  feat(ordering): takeaway/delivery as direct real orders with scheduling step
b6c779b  fix(orders): pin previous-day active orders, fix notification badge, restore portal link
59b0943  feat: takeaway/delivery ordering modes + UUID regex guard
...
```
