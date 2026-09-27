/**
 * Payment state vs fulfillment state (migration 024).
 * orders.status is the kitchen lifecycle; orders.payment_status is money.
 * Payment is recorded only by the owner (record_payment) or by a station
 * whose permissions include canRecordPayments (station_record_payment).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './support/db';
import { checkoutArgs, createTenant, type Tenant } from './support/fixtures';

type Res = { ok: boolean; error?: string; sessionToken?: string; order?: Record<string, unknown> };
type OrderRow = { status: string; payment_status: string; paid_at: string | null; order_number: number };

const BASE = { canAdvanceOrders: true, canCancelOrders: false, canLogKitchenEvents: false, canAdjustPrepTime: false, canReworkOrders: false, canUpdateTableStatus: false, visibleStatuses: ['placed', 'preparing', 'ready'] };

let db: TestDb;
let t: Tenant;
let other: Tenant;
let payToken: string;
let noPayToken: string;

async function placeOrder(tenant = t): Promise<string> {
  const r = await db.rpc<{ success: boolean; orderId: string; error?: string }>('anon', 'atomic_checkout', checkoutArgs(tenant, [{ menuItemId: tenant.soupId, quantity: 1 }]));
  if (!r.success) throw new Error(r.error);
  return r.orderId;
}
async function row(id: string): Promise<OrderRow> {
  const [r] = await db.sql<OrderRow>(`SELECT status, payment_status, paid_at, order_number FROM orders WHERE id=$1`, [id]);
  return r;
}
async function stationToken(permissions: Record<string, unknown>): Promise<string> {
  const s = await db.rpc<{ station?: { id: string } }>('authenticated', 'upsert_station', { p_station: { name: 'Counter', role: 'service', permissions } }, t.userId);
  const login = await db.rpc<Res>('anon', 'station_login', { p_restaurant_token: t.token, p_station_id: s.station?.id, p_pin: null });
  if (!login.ok || !login.sessionToken) throw new Error(login.error ?? 'station login failed');
  return login.sessionToken;
}

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, 'pay');
  other = await createTenant(db, 'pay-other');
  payToken = await stationToken({ ...BASE, canRecordPayments: true });
  noPayToken = await stationToken({ ...BASE, canRecordPayments: false });
});
afterAll(async () => { await db?.close(); });

describe('checkout creates a placed, unpaid order', () => {
  it('status placed, payment_status unpaid, paid_at NULL (order + receipt)', async () => {
    const id = await placeOrder();
    expect(await row(id)).toMatchObject({ status: 'placed', payment_status: 'unpaid', paid_at: null });
    const [receipt] = await db.sql<{ payment_status: string }>(`SELECT payment_status FROM receipts WHERE order_id=$1`, [id]);
    expect(receipt.payment_status).toBe('unpaid');
  });

  it('orders.paid_at has no default (a row inserted without it is not "paid")', async () => {
    const [c] = await db.sql<{ d: string | null }>(`SELECT column_default d FROM information_schema.columns WHERE table_name='orders' AND column_name='paid_at'`);
    expect(c.d).toBeNull();
  });

  it("the legacy fulfillment value 'paid' is rejected by the CHECK constraint", async () => {
    const id = await placeOrder();
    await expect(db.sql(`UPDATE orders SET status='paid' WHERE id=$1`, [id])).rejects.toThrow();
  });
});

describe('record_payment (owner)', () => {
  it('marks paid without changing the kitchen status; idempotent; receipt follows', async () => {
    const id = await placeOrder();
    const r = await db.rpc<Res>('authenticated', 'record_payment', { p_order_id: id }, t.userId);
    expect(r.ok).toBe(true);
    const after = await row(id);
    expect(after).toMatchObject({ status: 'placed', payment_status: 'paid' });
    expect(after.paid_at).not.toBeNull();
    const [receipt] = await db.sql<{ payment_status: string }>(`SELECT payment_status FROM receipts WHERE order_id=$1`, [id]);
    expect(receipt.payment_status).toBe('paid');
    expect((await db.rpc<Res>('authenticated', 'record_payment', { p_order_id: id }, t.userId)).ok).toBe(true);
    expect((await row(id)).paid_at).toEqual(after.paid_at);
  });

  it('another tenant cannot record payment on the order', async () => {
    const id = await placeOrder();
    const r = await db.rpc<Res>('authenticated', 'record_payment', { p_order_id: id }, other.userId);
    expect(r.ok).toBe(false);
    expect((await row(id)).payment_status).toBe('unpaid');
  });

  it('anon has no EXECUTE on record_payment or record_payment_internal', async () => {
    const id = await placeOrder();
    await expect(db.rpc('anon', 'record_payment', { p_order_id: id })).rejects.toThrow(/permission denied/);
    await expect(db.as('anon', `SELECT record_payment_internal($1, $2, 'x')`, [t.userId, id])).rejects.toThrow(/permission denied/);
    await expect(db.as('authenticated', `SELECT record_payment_internal($1, $2, 'x')`, [t.userId, id], t.userId)).rejects.toThrow(/permission denied/);
  });

  it('a cancelled order cannot be marked paid', async () => {
    const id = await placeOrder();
    expect((await db.rpc<Res>('authenticated', 'cancel_order', { p_order_id: id }, t.userId)).ok).toBe(true);
    const r = await db.rpc<Res>('authenticated', 'record_payment', { p_order_id: id }, t.userId);
    expect(r.ok).toBe(false);
    expect((await row(id)).payment_status).toBe('unpaid');
  });

  it('legacy_unverified orders are not silently converted', async () => {
    const id = await placeOrder();
    await db.sql(`UPDATE orders SET payment_status='legacy_unverified' WHERE id=$1`, [id]);
    expect((await db.rpc<Res>('authenticated', 'record_payment', { p_order_id: id }, t.userId)).ok).toBe(false);
    expect((await row(id)).payment_status).toBe('legacy_unverified');
  });
});

describe('refund reverses payment state', () => {
  it('paid -> cancelled -> refunded sets payment_status refunded', async () => {
    const id = await placeOrder();
    await db.rpc('authenticated', 'record_payment', { p_order_id: id }, t.userId);
    await db.rpc('authenticated', 'cancel_order', { p_order_id: id }, t.userId);
    const r = await db.rpc<Res>('authenticated', 'advance_order', { p_order_id: id, p_expected_status: 'cancelled', p_new_status: 'refunded' }, t.userId);
    expect(r.ok).toBe(true);
    expect(await row(id)).toMatchObject({ status: 'refunded', payment_status: 'refunded' });
  });

  it('an unpaid order that is refunded keeps payment_status unpaid (no money moved)', async () => {
    const id = await placeOrder();
    await db.rpc('authenticated', 'cancel_order', { p_order_id: id }, t.userId);
    await db.rpc('authenticated', 'advance_order', { p_order_id: id, p_expected_status: 'cancelled', p_new_status: 'refunded' }, t.userId);
    expect(await row(id)).toMatchObject({ status: 'refunded', payment_status: 'unpaid' });
  });
});

describe('station_record_payment', () => {
  it('a station with canRecordPayments can record payment', async () => {
    const id = await placeOrder();
    const r = await db.rpc<Res>('anon', 'station_record_payment', { p_session_token: payToken, p_order_id: id });
    expect(r.ok).toBe(true);
    expect((await row(id)).payment_status).toBe('paid');
  });

  it('a station without the permission, a bad session or a foreign order is rejected', async () => {
    const id = await placeOrder();
    expect((await db.rpc<Res>('anon', 'station_record_payment', { p_session_token: noPayToken, p_order_id: id })).ok).toBe(false);
    expect((await db.rpc<Res>('anon', 'station_record_payment', { p_session_token: 'f'.repeat(64), p_order_id: id })).ok).toBe(false);
    expect((await row(id)).payment_status).toBe('unpaid');
    const foreign = await placeOrder(other);
    expect((await db.rpc<Res>('anon', 'station_record_payment', { p_session_token: payToken, p_order_id: foreign })).ok).toBe(false);
    expect((await row(foreign)).payment_status).toBe('unpaid');
  });
});

describe('get_order_status (public tracker)', () => {
  it('returns placedAt and paymentStatus, never contact data; placedAt is set for unpaid orders', async () => {
    const id = await placeOrder();
    const { order_number } = await row(id);
    const r = await db.rpc<Record<string, unknown>>('anon', 'get_order_status', { p_restaurant_token: t.token, p_order_number: order_number });
    expect(r).toMatchObject({ ok: true, status: 'placed', paymentStatus: 'unpaid' });
    expect(r.placedAt).toBeTruthy();
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['customerPhone']));
    expect(JSON.stringify(r)).not.toMatch(/customer_?phone|delivery_?address|user_?id|customer_?email/i);
  });
});

describe('migration 024 backfill on existing station rows', () => {
  it('service stations gain canRecordPayments and legacy visibleStatuses map paid -> placed', async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      `INSERT INTO stations(user_id, name, role, permissions) VALUES ($1, 'Legacy', 'service', $2::jsonb) RETURNING id`,
      [t.userId, JSON.stringify({ canAdvanceOrders: true, visibleStatuses: ['paid', 'ready'] })]);
    const [k] = await db.sql<{ id: string }>(
      `INSERT INTO stations(user_id, name, role, permissions) VALUES ($1, 'LegacyK', 'kitchen', $2::jsonb) RETURNING id`,
      [t.userId, JSON.stringify({ visibleStatuses: ['paid'] })]);
    await db.sql(`
      UPDATE stations SET permissions = permissions || jsonb_build_object('canRecordPayments', true)
       WHERE role = 'service' AND NOT (permissions ? 'canRecordPayments')`);
    await db.sql(`
      UPDATE stations SET permissions = jsonb_set(permissions, '{visibleStatuses}',
        (SELECT COALESCE(jsonb_agg(CASE WHEN v = 'paid' THEN 'placed' ELSE v END), '[]'::jsonb) FROM jsonb_array_elements_text(permissions->'visibleStatuses') v))
       WHERE jsonb_typeof(permissions->'visibleStatuses') = 'array' AND permissions->'visibleStatuses' ? 'paid'`);
    const [svc] = await db.sql<{ permissions: Record<string, unknown> }>(`SELECT permissions FROM stations WHERE id=$1`, [id]);
    const [kit] = await db.sql<{ permissions: Record<string, unknown> }>(`SELECT permissions FROM stations WHERE id=$1`, [k.id]);
    expect(svc.permissions).toMatchObject({ canRecordPayments: true, visibleStatuses: ['placed', 'ready'] });
    expect(kit.permissions).toEqual({ visibleStatuses: ['placed'] });
  });
});
