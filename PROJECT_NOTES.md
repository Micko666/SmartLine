# PROJECT_NOTES.md

Running log of changes, known issues, and task status. Newest first.

---

## Sep 2026 — Stabilization, security hardening and refactor (`stabilization/astra`)

Full report: `docs/stabilization-execution.md`. Audit that triggered it: `docs/stabilization-audit/`.

### Highlights
- Fixed: takeaway/delivery portal crash (`noSlotsToday`), local refresh data loss, Supabase refresh losing stations, admin cancel not restoring stock in the DB, off-by-one dates in the Calendar/Roster grids east of UTC.
- Security (migrations 015–023): no anon table access; server-authoritative, all-or-nothing, idempotent checkout; station PINs hashed with server sessions and permission checks; booking status/type decided by the server; minimized public RPCs; least-privilege function grants (closed a PUBLIC-executable SECURITY DEFINER helper).
- DB is reproducible from the repo: `npm run test:db` replays every migration on PGlite and compares against a production catalog snapshot.
- Shared domain rules (`src/domain`) mirror the SQL; parity tests keep local and Supabase modes identical.
- Restaurant timezone used for all business dates/hours.
- Structured customer fields on orders; no PII in URLs; `payment_status` separated from the kitchen status.
- Store split into slices; big pages split into per-component folders; strict TypeScript; CI workflow; E2E smoke.

### Not applied / open
- Migrations 015–023 are **not applied to production**. Frontend and DB must ship together (runbook in the execution report).
- Product decisions: generic dine-in picker, local/demo mode future, payment provider, public roster.
- Delivery map (unchanged TODO).

### Tests
- `npm test`: 133 · `npm run test:db`: 140 · `npm run test:e2e`: 6. All green.

---

## Apr 2026 — Ordering modes + bug patch (historical)

- Added takeaway/delivery ordering with a scheduling step, `takeaway_enabled` / `delivery_enabled`, UUID guard for keyword table ids (migrations 011–012).
- Admin: today-only notification badge, carry-over section for previous-day active orders.
- Receipt "Order More" preserves mode/date/time.
- Structured opening hours and `scheduled_for` were added later in migration 013.

Superseded by the Sep 2026 stabilization: delivery address no longer in URLs, customer contact no longer in `notes`, scheduling uses the restaurant timezone.
