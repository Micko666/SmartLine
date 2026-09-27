import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './support/db';
import { burger, checkoutArgs, createTenant, stockOf, type Tenant } from './support/fixtures';

type Res = { ok: boolean; error?: string; sessionToken?: string; orders?: Array<Record<string, unknown>>; station?: Record<string, unknown> };

const KITCHEN = { canAdvanceOrders: true, canCancelOrders: false, canLogKitchenEvents: true, canAdjustPrepTime: true, canReworkOrders: true, canUpdateTableStatus: false, visibleStatuses: ['paid', 'preparing', 'ready'] };
const SERVICE = { canAdvanceOrders: true, canCancelOrders: true, canLogKitchenEvents: false, canAdjustPrepTime: false, canReworkOrders: false, canUpdateTableStatus: true, visibleStatuses: ['paid', 'preparing', 'ready'] };

let db: TestDb;
let t: Tenant;
let other: Tenant;
let kitchenId: string;
let serviceId: string;

async function upsert(owner: string, station: Record<string, unknown>): Promise<Res> {
  return db.rpc<Res>('authenticated', 'upsert_station', { p_station: station }, owner);
}
async function login(stationId: string, pin: string | null, token = t.token): Promise<Res> {
  return db.rpc<Res>('anon', 'station_login', { p_restaurant_token: token, p_station_id: stationId, p_pin: pin });
}
async function order(tenant = t, qty = 1): Promise<string> {
  const r = await db.rpc<{ success: boolean; orderId: string; error?: string }>('anon', 'atomic_checkout', checkoutArgs(tenant, [burger(tenant, qty)]));
  if (!r.success) throw new Error(r.error);
  return r.orderId;
}

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, 'st');
  other = await createTenant(db, 'other');
  kitchenId = String((await upsert(t.userId, { name: 'Kitchen', role: 'kitchen', color: '#e8521a', permissions: KITCHEN, pin: '1234' })).station?.id);
  serviceId = String((await upsert(t.userId, { name: 'Floor', role: 'service', permissions: SERVICE, pin: '5678' })).station?.id);
});
afterAll(async () => { await db?.close(); });

describe('station credentials', () => {
  it('stores only a bcrypt hash of the PIN and never returns it', async () => {
    const [row] = await db.sql<{ pin_hash: string }>(`SELECT pin_hash FROM stations WHERE id=$1`, [kitchenId]);
    expect(row.pin_hash).toMatch(/^\$2[aby]\$/);
    const list = await db.rpc<unknown[]>('authenticated', 'list_stations', {}, t.userId);
    expect(JSON.stringify(list)).not.toMatch(/1234|pin_hash|"pin"/);
    const config = await db.rpc<Res>('anon', 'station_public_config', { p_restaurant_token: t.token, p_station_id: kitchenId });
    expect(config.ok).toBe(true);
    expect(JSON.stringify(config)).not.toMatch(/1234|pin_hash|"pin"/);
  });

  it('anon and other owners cannot read stations or sessions directly', async () => {
    await expect(db.as('anon', 'SELECT * FROM stations')).rejects.toThrow(/permission denied/);
    await expect(db.as('authenticated', 'SELECT * FROM station_sessions', [], t.userId)).rejects.toThrow(/permission denied/);
    expect(await db.rpc<unknown[]>('authenticated', 'list_stations', {}, other.userId)).toEqual([]);
  });

  it('rejects a wrong PIN, a wrong restaurant token and locks after 5 failures', async () => {
    expect((await login(kitchenId, '0000')).ok).toBe(false);
    expect((await login(kitchenId, '1234', other.token)).ok).toBe(false);
    const locker = String((await upsert(t.userId, { name: 'Bar', role: 'bar', permissions: KITCHEN, pin: '4321' })).station?.id);
    for (let i = 0; i < 5; i++) await login(locker, '9999');
    const locked = await login(locker, '4321');
    expect(locked.ok).toBe(false);
    expect(locked.error).toMatch(/Too many attempts/);
  });

  it('returns an opaque token; only its SHA-256 is stored', async () => {
    const r = await login(kitchenId, '1234');
    expect(r.ok).toBe(true);
    expect(r.sessionToken).toMatch(/^[0-9a-f]{64}$/);
    const rows = await db.sql<{ token_hash: string }>(`SELECT token_hash FROM station_sessions WHERE station_id=$1`, [kitchenId]);
    expect(rows.some(x => x.token_hash === r.sessionToken)).toBe(false);
  });

  it('owner cannot edit another tenant station; PIN must be 4-6 digits', async () => {
    expect((await upsert(other.userId, { id: kitchenId, name: 'Hijack', role: 'kitchen', permissions: {} })).ok).toBe(false);
    expect((await upsert(t.userId, { name: 'Bad', role: 'kitchen', permissions: {}, pin: '12' })).ok).toBe(false);
  });
});

describe('station operations require a session and server-side permissions', () => {
  it('every station RPC rejects a missing or forged session', async () => {
    const id = await order();
    const forged = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    for (const token of [null, '', forged]) {
      expect((await db.rpc<Res>('anon', 'station_get_orders', { p_session_token: token })).ok).toBe(false);
      expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'paid', p_new_status: 'preparing' })).ok).toBe(false);
      expect((await db.rpc<Res>('anon', 'station_adjust_prep_time', { p_session_token: token, p_order_id: id, p_delta_minutes: 5 })).ok).toBe(false);
      expect((await db.rpc<Res>('anon', 'station_log_kitchen_event', { p_session_token: token, p_order_id: id, p_type: 'note', p_notes: 'x' })).ok).toBe(false);
      expect((await db.rpc<Res>('anon', 'station_set_table_status', { p_session_token: token, p_table_id: t.tableId, p_status: 'available' })).ok).toBe(false);
    }
  });

  it('kitchen: may advance, may not cancel or change tables; invalid transitions rejected', async () => {
    const token = (await login(kitchenId, '1234')).sessionToken;
    const id = await order();
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'paid', p_new_status: 'cancelled' })).ok).toBe(false);
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'paid', p_new_status: 'ready' })).ok).toBe(false);
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'paid', p_new_status: 'preparing' })).ok).toBe(true);
    expect((await db.rpc<Res>('anon', 'station_set_table_status', { p_session_token: token, p_table_id: t.tableId, p_status: 'available' })).ok).toBe(false);
  });

  it('kitchen rework: ready -> preparing needs canReworkOrders and logs a remake', async () => {
    const token = (await login(kitchenId, '1234')).sessionToken;
    const id = await order();
    for (const [e, n] of [['paid', 'preparing'], ['preparing', 'ready']]) {
      await db.rpc('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: e, p_new_status: n });
    }
    expect((await db.rpc<Res>('anon', 'station_log_kitchen_event', { p_session_token: token, p_order_id: id, p_type: 'remake', p_notes: 'Burnt' })).ok).toBe(true);
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'ready', p_new_status: 'preparing' })).ok).toBe(true);
    const service = (await login(serviceId, '5678')).sessionToken;
    await db.rpc('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'preparing', p_new_status: 'ready' });
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: service, p_order_id: id, p_expected_status: 'ready', p_new_status: 'preparing' })).ok).toBe(false);
  });

  it('service cancel restores stock exactly once and frees the table', async () => {
    const token = (await login(serviceId, '5678')).sessionToken;
    const before = await stockOf(db, t.burgerId);
    const id = await order(t, 2);
    expect(await stockOf(db, t.burgerId)).toBe((before ?? 0) - 2);
    const args = { p_session_token: token, p_order_id: id, p_expected_status: 'paid', p_new_status: 'cancelled' };
    expect((await db.rpc<Res>('anon', 'station_advance_order', args)).ok).toBe(true);
    expect((await db.rpc<Res>('anon', 'station_advance_order', args)).ok).toBe(true);
    expect(await stockOf(db, t.burgerId)).toBe(before);
  });

  it('stations can never refund and cannot touch other tenants', async () => {
    const token = (await login(serviceId, '5678')).sessionToken;
    const id = await order();
    await db.rpc('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'paid', p_new_status: 'cancelled' });
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: id, p_expected_status: 'cancelled', p_new_status: 'refunded' })).ok).toBe(false);
    const foreign = await order(other);
    expect((await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: token, p_order_id: foreign, p_expected_status: 'paid', p_new_status: 'preparing' })).ok).toBe(false);
  });

  it('prep time needs permission and is clamped to [-60, 180]', async () => {
    const kitchen = (await login(kitchenId, '1234')).sessionToken;
    const service = (await login(serviceId, '5678')).sessionToken;
    const id = await order();
    expect((await db.rpc<Res>('anon', 'station_adjust_prep_time', { p_session_token: service, p_order_id: id, p_delta_minutes: 5 })).ok).toBe(false);
    for (let i = 0; i < 3; i++) await db.rpc('anon', 'station_adjust_prep_time', { p_session_token: kitchen, p_order_id: id, p_delta_minutes: 90 });
    const [o] = await db.sql<{ prep_time_adjustment: number }>(`SELECT prep_time_adjustment FROM orders WHERE id=$1`, [id]);
    expect(o.prep_time_adjustment).toBe(180);
  });

  it('service may set table status; get_orders hides contact data from kitchen', async () => {
    const service = (await login(serviceId, '5678')).sessionToken;
    expect((await db.rpc<Res>('anon', 'station_set_table_status', { p_session_token: service, p_table_id: t.tableId, p_status: 'reserved' })).ok).toBe(true);
    await db.rpc('anon', 'atomic_checkout', checkoutArgs(t, [{ menuItemId: t.soupId, quantity: 1 }], { p_table_id: 'delivery', p_customer_name: 'Ana', p_customer_phone: '+38267111222', p_delivery_address: 'Secret street 9' }));
    const kitchen = (await login(kitchenId, '1234')).sessionToken;
    const k = await db.rpc<Res>('anon', 'station_get_orders', { p_session_token: kitchen });
    const s = await db.rpc<Res>('anon', 'station_get_orders', { p_session_token: service });
    expect(JSON.stringify(k.orders)).not.toContain('Secret street 9');
    expect(JSON.stringify(k.orders)).not.toContain('+38267111222');
    expect(JSON.stringify(s.orders)).toContain('Secret street 9');
    expect(k.orders?.every(o => ['paid', 'preparing', 'ready'].includes(String(o.status)))).toBe(true);
  });

  it('changing the PIN revokes existing sessions', async () => {
    const token = (await login(serviceId, '5678')).sessionToken;
    await upsert(t.userId, { id: serviceId, name: 'Floor', role: 'service', permissions: SERVICE, pin: '8765' });
    expect((await db.rpc<Res>('anon', 'station_get_orders', { p_session_token: token })).ok).toBe(false);
  });
});

describe('legacy backfill (business_settings.stations)', () => {
  it('migrates legacy plaintext-PIN stations into hashed rows and scrubs the PIN', async () => {
    const fresh = await createTestDb();
    try {
      // Replay stops before 018 is impossible in-process, so emulate the legacy row and rerun the backfill SQL.
      const tenant = await createTenant(fresh, 'legacy');
      const legacyId = randomUUID();
      await fresh.sql(`UPDATE business_settings SET stations=$2 WHERE user_id=$1`, [tenant.userId, JSON.stringify([{ id: legacyId, name: 'Old kitchen', role: 'kitchen', pin: '2468', color: '#111111', permissions: KITCHEN }])]);
      const { readFileSync } = await import('node:fs');
      const sql = readFileSync(new URL('../migrations/018_station_auth.sql', import.meta.url), 'utf8');
      const backfill = sql.slice(sql.indexOf('-- ─── Backfill'), sql.indexOf('-- ─── Remove the unauthenticated'));
      await fresh.pg.exec(backfill);
      const [row] = await fresh.sql<{ name: string; pin_hash: string }>(`SELECT name, pin_hash FROM stations WHERE id=$1`, [legacyId]);
      expect(row.name).toBe('Old kitchen');
      expect(row.pin_hash).toMatch(/^\$2/);
      const [s] = await fresh.sql<{ stations: unknown }>(`SELECT stations FROM business_settings WHERE user_id=$1`, [tenant.userId]);
      expect(JSON.stringify(s.stations)).not.toContain('2468');
      expect((await fresh.rpc<Res>('anon', 'station_login', { p_restaurant_token: tenant.token, p_station_id: legacyId, p_pin: '2468' })).ok).toBe(true);
    } finally {
      await fresh.close();
    }
  });
});
