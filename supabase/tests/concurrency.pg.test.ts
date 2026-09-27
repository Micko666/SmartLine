/**
 * Concurrency on a REAL PostgreSQL server (readiness step 3).
 *
 * PGlite is single-connection, so these run only when SMARTLINE_PG_URL
 * points at a disposable local server (npm run test:pg). Every call uses its
 * own connection and transaction, exactly like PostgREST.
 *
 * Two kinds of evidence per scenario:
 *  - held lock: transaction 1 stays open while transaction 2 is observed in
 *    pg_stat_activity waiting on a Lock, then 1 commits and 2 resolves;
 *  - burst: many truly parallel RPCs, repeated, invariants checked each round.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createRealDb, REAL_PG_URL, type RealDb } from './support/realdb';
import { burger, checkoutArgs, createTenant, stockOf, type Tenant } from './support/fixtures';

type Checkout = { success: boolean; orderId?: string; error?: string };
type Ok = { ok: boolean; error?: string };

const ROUNDS = 10;
const PARALLEL = 8;

let db: RealDb;
let t: Tenant;

const salad = (tenant = t) => ({ menuItemId: tenant.saladId, quantity: 1 });
const checkout = (args: Record<string, unknown>) => db.rpc<Checkout>('anon', 'atomic_checkout', args);

async function waitUntilLockWait(pid: number, timeoutMs = 10_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const [row] = await db.sql<{ wait_event_type: string | null; state: string }>(
      `SELECT wait_event_type, state FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return 'Lock';
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error(`backend ${pid} never waited on a lock`);
}

async function ordersFor(itemId: string): Promise<number> {
  const [r] = await db.sql<{ n: number }>(
    `SELECT count(*)::int AS n FROM orders o, jsonb_array_elements(o.items) i WHERE o.user_id=$1 AND i->>'menuItemId'=$2`, [t.userId, itemId]);
  return r.n;
}

describe.skipIf(!REAL_PG_URL)('real PostgreSQL concurrency', () => {
  beforeAll(async () => {
    db = await createRealDb();
    t = await createTenant(db, 'conc');
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  it('server identity (evidence)', async () => {
    const [v] = await db.sql<{ version: string }>(`SELECT version()`);
    expect(v.version).toMatch(/^PostgreSQL 17\./);
    console.info(`[real-pg] ${v.version} db=${db.name}`);
  });

  describe('A: last unit', () => {
    it('held lock: the second checkout blocks on the first, then fails; stock ends at 0', async () => {
      await db.sql(`UPDATE menu_items SET stock=1 WHERE id=$1`, [t.saladId]);
      const before = await ordersFor(t.saladId);
      const tx1 = await db.begin('anon');
      const tx2 = await db.begin('anon');
      try {
        const r1 = await tx1.call<Checkout>('atomic_checkout', checkoutArgs(t, [salad()]));
        expect(r1.success).toBe(true);
        const p2 = tx2.call<Checkout>('atomic_checkout', checkoutArgs(t, [salad()]));
        expect(await waitUntilLockWait(tx2.pid)).toBe('Lock');
        await tx1.commit();
        const r2 = await p2;
        await tx2.commit();
        expect(r2.success).toBe(false);
        expect(String(r2.error)).toMatch(/stock/i);
      } finally { await tx1.rollback(); await tx2.rollback(); }
      expect(await stockOf(db, t.saladId)).toBe(0);
      expect(await ordersFor(t.saladId)).toBe(before + 1);
    });

    it(`burst: ${ROUNDS} rounds x ${PARALLEL} parallel checkouts for 1 unit -> exactly one wins, never negative`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await db.sql(`UPDATE menu_items SET stock=1 WHERE id=$1`, [t.saladId]);
        const results = await Promise.all(Array.from({ length: PARALLEL }, () => checkout(checkoutArgs(t, [salad()]))));
        expect(results.filter(r => r.success), `round ${round}`).toHaveLength(1);
        expect(results.filter(r => !r.success).every(r => /stock/i.test(String(r.error))), `round ${round}`).toBe(true);
        expect(await stockOf(db, t.saladId), `round ${round}`).toBe(0);
      }
    });
  });

  describe('B: idempotency under parallel retries', () => {
    it('held lock: a retry with the same key waits, then returns the same order (no duplicate, single deduction)', async () => {
      await db.sql(`UPDATE menu_items SET stock=5 WHERE id=$1`, [t.burgerId]);
      const args = checkoutArgs(t, [burger(t, 1)]);
      const tx1 = await db.begin('anon');
      const tx2 = await db.begin('anon');
      try {
        const r1 = await tx1.call<Checkout>('atomic_checkout', args);
        const p2 = tx2.call<Checkout>('atomic_checkout', args);
        await waitUntilLockWait(tx2.pid);
        await tx1.commit();
        const r2 = await p2;
        await tx2.commit();
        expect(r1.success && r2.success).toBe(true);
        expect(r2.orderId).toBe(r1.orderId);
      } finally { await tx1.rollback(); await tx2.rollback(); }
      const [c] = await db.sql<{ n: number }>(`SELECT count(*)::int n FROM orders WHERE user_id=$1 AND client_order_id=$2`, [t.userId, args.p_client_order_id]);
      expect(c.n).toBe(1);
      expect(await stockOf(db, t.burgerId)).toBe(4);
    });

    it(`burst: ${ROUNDS} rounds x ${PARALLEL} parallel submits of one key -> one order, one order number, one deduction`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await db.sql(`UPDATE menu_items SET stock=5 WHERE id=$1`, [t.burgerId]);
        const args = checkoutArgs(t, [burger(t, 1)]);
        const results = await Promise.all(Array.from({ length: PARALLEL }, () => checkout(args)));
        expect(results.every(r => r.success), `round ${round}`).toBe(true);
        expect(new Set(results.map(r => r.orderId)).size, `round ${round}`).toBe(1);
        const [c] = await db.sql<{ n: number; r: number }>(
          `SELECT count(*)::int n, (SELECT count(*)::int FROM receipts WHERE order_id=(SELECT id FROM orders WHERE client_order_id=$2)) r FROM orders WHERE user_id=$1 AND client_order_id=$2`,
          [t.userId, args.p_client_order_id]);
        expect(c, `round ${round}`).toEqual({ n: 1, r: 1 });
        expect(await stockOf(db, t.burgerId), `round ${round}`).toBe(4);
      }
    });

    it('order numbers stay unique under parallel distinct checkouts', async () => {
      await db.sql(`UPDATE menu_items SET stock=NULL WHERE id=$1`, [t.soupId]);
      await Promise.all(Array.from({ length: 30 }, () => checkout(checkoutArgs(t, [{ menuItemId: t.soupId, quantity: 1 }]))));
      const [d] = await db.sql<{ dup: number }>(`SELECT count(*)::int dup FROM (SELECT order_number FROM orders WHERE user_id=$1 GROUP BY 1 HAVING count(*)>1) x`, [t.userId]);
      expect(d.dup).toBe(0);
    });
  });

  describe('C: partial cart', () => {
    it('held lock: a mixed cart losing the last unit fails entirely (no partial deduction, no order)', async () => {
      await db.sql(`UPDATE menu_items SET stock=1 WHERE id=$1`, [t.saladId]);
      await db.sql(`UPDATE menu_items SET stock=5 WHERE id=$1`, [t.burgerId]);
      const mixed = checkoutArgs(t, [burger(t, 2), salad()]);
      const tx1 = await db.begin('anon');
      const tx2 = await db.begin('anon');
      try {
        expect((await tx1.call<Checkout>('atomic_checkout', checkoutArgs(t, [salad()]))).success).toBe(true);
        const p2 = tx2.call<Checkout>('atomic_checkout', mixed);
        await waitUntilLockWait(tx2.pid);
        await tx1.commit();
        const r2 = await p2;
        await tx2.commit();
        expect(r2.success).toBe(false);
      } finally { await tx1.rollback(); await tx2.rollback(); }
      expect(await stockOf(db, t.burgerId)).toBe(5);
      expect(await stockOf(db, t.saladId)).toBe(0);
      const [c] = await db.sql<{ n: number }>(`SELECT count(*)::int n FROM orders WHERE user_id=$1 AND client_order_id=$2`, [t.userId, mixed.p_client_order_id]);
      expect(c.n).toBe(0);
    });

    it(`burst: ${ROUNDS} rounds of mixed + single carts in parallel keep stock == sold quantities`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await db.sql(`UPDATE menu_items SET stock=1 WHERE id=$1`, [t.saladId]);
        await db.sql(`UPDATE menu_items SET stock=5 WHERE id=$1`, [t.burgerId]);
        const mixed = Array.from({ length: PARALLEL / 2 }, () => checkoutArgs(t, [burger(t, 2), salad()]));
        const single = Array.from({ length: PARALLEL / 2 }, () => checkoutArgs(t, [salad()]));
        const all = [...mixed, ...single].sort(() => Math.random() - 0.5);
        const results = await Promise.all(all.map(a => checkout(a)));
        const won = all.filter((_, i) => results[i].success);
        expect(won, `round ${round}`).toHaveLength(1);
        const burgersSold = won.filter(a => mixed.includes(a)).length * 2;
        expect(await stockOf(db, t.burgerId), `round ${round}`).toBe(5 - burgersSold);
        expect(await stockOf(db, t.saladId), `round ${round}`).toBe(0);
        const [leftover] = await db.sql<{ n: number }>(`SELECT count(*)::int n FROM stock_reservations`);
        expect(leftover.n, `round ${round}: no leaked reservations`).toBe(0);
      }
    });
  });

  describe('D: other write races', () => {
    it('two operators advancing the same order with the same expected status: exactly one succeeds', async () => {
      for (let round = 0; round < ROUNDS; round++) {
        const r = await checkout(checkoutArgs(t, [{ menuItemId: t.soupId, quantity: 1 }]));
        const args = { p_order_id: r.orderId, p_expected_status: 'placed', p_new_status: 'preparing' };
        const res = await Promise.all(Array.from({ length: 4 }, () => db.rpc<Ok>('authenticated', 'advance_order', args, t.userId)));
        expect(res.filter(x => x.ok), `round ${round}`).toHaveLength(1);
      }
    });

    it('parallel cancels restore stock exactly once', async () => {
      await db.sql(`UPDATE menu_items SET stock=5 WHERE id=$1`, [t.burgerId]);
      const r = await checkout(checkoutArgs(t, [burger(t, 3)]));
      expect(await stockOf(db, t.burgerId)).toBe(2);
      await Promise.all(Array.from({ length: 6 }, () => db.rpc<Ok>('authenticated', 'cancel_order', { p_order_id: r.orderId }, t.userId)));
      expect(await stockOf(db, t.burgerId)).toBe(5);
    });

    it('parallel record_payment is idempotent (one paid_at)', async () => {
      const r = await checkout(checkoutArgs(t, [{ menuItemId: t.soupId, quantity: 1 }]));
      const res = await Promise.all(Array.from({ length: 6 }, () => db.rpc<Ok>('authenticated', 'record_payment', { p_order_id: r.orderId }, t.userId)));
      expect(res.every(x => x.ok)).toBe(true);
      const [o] = await db.sql<{ payment_status: string; paid_at: Date }>(`SELECT payment_status, paid_at FROM orders WHERE id=$1`, [r.orderId]);
      expect(o.payment_status).toBe('paid');
      expect(o.paid_at).toBeTruthy();
    });

    it('parallel bookings never exceed maxEventsPerDay', async () => {
      const b = await createTenant(db, 'conc-book', { calendar_settings: JSON.stringify({ maxEventsPerDay: 2, requireApproval: false, advanceBookingDays: 30 }) });
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Podgorica' }).format(new Date(Date.now() + 5 * 86_400_000));
      const res = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => db.rpc<Ok>('anon', 'submit_booking', {
        p_restaurant_token: b.token, p_client_request_id: randomUUID(), p_date: date, p_time_slot: '19:00', p_type: 'reservation',
        p_customer_name: `Guest ${i}`, p_customer_phone: `+38267000${100 + i}`, p_customer_email: '', p_guest_count: 2, p_package_id: null, p_notes: '',
      })));
      expect(res.filter(x => x.ok)).toHaveLength(2);
      const [c] = await db.sql<{ n: number }>(`SELECT count(*)::int n FROM calendar_events WHERE user_id=$1 AND date=$2`, [b.userId, date]);
      expect(c.n).toBe(2);
    });
  });
});
