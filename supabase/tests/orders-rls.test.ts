import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './support/db';
import { burger, checkoutArgs, createTenant, stockOf, type Tenant } from './support/fixtures';

type Ok = { ok: boolean; error?: string; order?: Record<string, unknown>; item?: Record<string, unknown>; settings?: Record<string, unknown> };

let db: TestDb;
let a: Tenant;
let b: Tenant;

/** Burger (stock-tracked) for stock assertions; soup (unlimited) for state-machine tests. */
async function placeOrder(t: Tenant, qty = 2, item: 'burger' | 'soup' = 'burger'): Promise<string> {
  const line = item === 'burger' ? burger(t, qty) : { menuItemId: t.soupId, quantity: qty };
  const r = await db.rpc<{ success: boolean; orderId: string; error?: string }>('anon', 'atomic_checkout', checkoutArgs(t, [line]));
  if (!r.success) throw new Error(r.error);
  return r.orderId;
}

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, 'a');
  b = await createTenant(db, 'b');
  await placeOrder(a); await placeOrder(b);
});
afterAll(async () => { await db?.close(); });

describe('RLS: anonymous and cross-tenant reads', () => {
  it.each(['orders', 'tables', 'receipts', 'business_settings', 'menu_items', 'employees', 'shifts', 'calendar_events', 'stock_reservations', 'ingredients', 'kitchen_events', 'map_decorations', 'event_packages'])(
    'anon cannot select %s', async table => {
      expect(await db.as('anon', `SELECT * FROM ${table}`)).toHaveLength(0);
    },
  );

  it('owner A sees only tenant A orders and tables; owner B only B', async () => {
    const ordersA = await db.as<{ user_id: string }>('authenticated', 'SELECT user_id FROM orders', [], a.userId);
    const ordersB = await db.as<{ user_id: string }>('authenticated', 'SELECT user_id FROM orders', [], b.userId);
    expect(ordersA.length).toBeGreaterThan(0);
    expect(ordersA.every(o => o.user_id === a.userId)).toBe(true);
    expect(ordersB.every(o => o.user_id === b.userId)).toBe(true);
    const tablesA = await db.as<{ user_id: string }>('authenticated', 'SELECT user_id FROM tables', [], a.userId);
    expect(tablesA.every(t => t.user_id === a.userId)).toBe(true);
  });

  it('owner A cannot update tenant B rows', async () => {
    await db.as('authenticated', `UPDATE menu_items SET price = 0 WHERE user_id = $1`, [b.userId], a.userId);
    const [row] = await db.sql<{ price: string }>(`SELECT price FROM menu_items WHERE id=$1`, [b.burgerId]);
    expect(Number(row.price)).toBe(10);
  });

  it('anon cannot insert orders directly', async () => {
    await expect(db.as('anon', `INSERT INTO orders(user_id, order_number, items) VALUES ($1, 1, '[]')`, [a.userId])).rejects.toThrow();
  });

  it('API roles lack TRUNCATE/REFERENCES/TRIGGER on public tables', async () => {
    const rows = await db.sql<{ grantee: string; privilege_type: string; table_name: string }>(`
      SELECT grantee, privilege_type, table_name FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated') AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')`);
    expect(rows).toEqual([]);
  });
});

describe('order state machine (server enforced)', () => {
  it.each([
    ['paid', 'ready'], ['paid', 'completed'], ['ready', 'paid'], ['completed', 'preparing'], ['completed', 'refunded'], ['paid', 'served'],
  ])('rejects %s -> %s even for the owner', async (from, to) => {
    const id = await placeOrder(a, 1, 'soup');
    if (from !== 'paid') {
      const path: Record<string, string[]> = { ready: ['preparing', 'ready'], completed: ['preparing', 'ready', 'completed'] };
      for (const step of path[from]) await db.sql(`UPDATE orders SET status=$2 WHERE id=$1`, [id, step]);
    }
    await expect(db.as('authenticated', `UPDATE orders SET status=$2 WHERE id=$1`, [id, to], a.userId)).rejects.toThrow();
  });

  it('advance_order enforces the expected status (no stale overwrite)', async () => {
    const id = await placeOrder(a, 1, 'soup');
    expect((await db.rpc<Ok>('authenticated', 'advance_order', { p_order_id: id, p_expected_status: 'paid', p_new_status: 'preparing' }, a.userId)).ok).toBe(true);
    const stale = await db.rpc<Ok>('authenticated', 'advance_order', { p_order_id: id, p_expected_status: 'paid', p_new_status: 'preparing' }, a.userId);
    expect(stale.ok).toBe(false);
  });

  it('advance_order cannot touch another tenant order and requires auth', async () => {
    const id = await placeOrder(b, 1, 'soup');
    expect((await db.rpc<Ok>('authenticated', 'advance_order', { p_order_id: id, p_expected_status: 'paid', p_new_status: 'preparing' }, a.userId)).ok).toBe(false);
    await expect(db.rpc<Ok>('anon', 'advance_order', { p_order_id: id, p_expected_status: 'paid', p_new_status: 'preparing' })).rejects.toThrow(/permission denied/);
  });
});

describe('cancel_order: one transaction, stock restored exactly once', () => {
  it('restores stock once and frees the table', async () => {
    const t = await createTenant(db, 'cancel');
    const id = await placeOrder(t, 2);
    expect(await stockOf(db, t.burgerId)).toBe(3);
    const first = await db.rpc<Ok>('authenticated', 'cancel_order', { p_order_id: id }, t.userId);
    expect(first.ok).toBe(true);
    expect(await stockOf(db, t.burgerId)).toBe(5);
    const second = await db.rpc<Ok>('authenticated', 'cancel_order', { p_order_id: id }, t.userId);
    expect(second.ok).toBe(true);
    expect(await stockOf(db, t.burgerId)).toBe(5);
    const [table] = await db.sql<{ status: string }>(`SELECT status FROM tables WHERE id=$1`, [t.tableId]);
    expect(table.status).toBe('available');
  });

  it('cannot cancel a completed order', async () => {
    const t = await createTenant(db, 'cancel2');
    const id = await placeOrder(t, 1);
    for (const [e, n] of [['paid', 'preparing'], ['preparing', 'ready'], ['ready', 'completed']]) {
      await db.rpc('authenticated', 'advance_order', { p_order_id: id, p_expected_status: e, p_new_status: n }, t.userId);
    }
    expect((await db.rpc<Ok>('authenticated', 'cancel_order', { p_order_id: id }, t.userId)).ok).toBe(false);
    expect(await stockOf(db, t.burgerId)).toBe(4);
  });
});

describe('concurrency-safe admin writes', () => {
  it('adjust_stock applies a relative delta against current DB stock', async () => {
    const t = await createTenant(db, 'stock');
    await placeOrder(t, 2);                                   // stock 5 -> 3 on the server
    const r = await db.rpc<Ok>('authenticated', 'adjust_stock', { p_item_id: t.burgerId, p_delta: 1 }, t.userId);
    expect(r.ok).toBe(true);
    expect(await stockOf(db, t.burgerId)).toBe(4);            // not the stale client value 6
    expect((await db.rpc<Ok>('authenticated', 'adjust_stock', { p_item_id: t.burgerId, p_delta: 1 }, b.userId)).ok).toBe(false);
  });

  it('patch_settings changes only named fields and rejects protected ones', async () => {
    const t = await createTenant(db, 'patch');
    const r = await db.rpc<Ok>('authenticated', 'patch_settings', { p_patch: { ordering_paused: true } }, t.userId);
    expect(r.ok).toBe(true);
    const [s] = await db.sql<{ ordering_paused: boolean; business_name: string }>(`SELECT ordering_paused, business_name FROM business_settings WHERE user_id=$1`, [t.userId]);
    expect(s).toEqual({ ordering_paused: true, business_name: 'Restaurant patch' });
    for (const bad of [{ restaurant_token: 'x' }, { next_order_number: 1 }, { user_id: a.userId }, { stations: [] }]) {
      expect((await db.rpc<Ok>('authenticated', 'patch_settings', { p_patch: bad }, t.userId)).ok).toBe(false);
    }
    expect((await db.rpc<Ok>('authenticated', 'patch_settings', { p_patch: { timezone: 'Mars/Base' } }, t.userId)).ok).toBe(false);
  });
});
