/**
 * Release security regression (readiness steps 7 + 8).
 *
 *  - Function security table: every public function is classified as
 *    public API / owner API / internal; SECURITY DEFINER pins search_path;
 *    internal helpers (incl. transition_order_internal, record_payment_internal)
 *    are not executable by anon or authenticated.
 *  - transition_order_internal cannot be reached cross-tenant through any
 *    wrapper (owner RPC or station RPC).
 *  - Anonymous attack surface: direct table access returns nothing or is
 *    denied; every anon-callable RPC payload is scanned for secrets / PII.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './support/db';
import { checkoutArgs, createTenant, type Tenant } from './support/fixtures';

type Res = Record<string, unknown> & { ok?: boolean; success?: boolean; error?: string };

const PUBLIC_API = new Set(['atomic_checkout', 'get_customer_menu', 'get_booking_data', 'submit_booking', 'lookup_booking_status', 'get_roster_data', 'get_order_status', 'get_receipt_by_id', 'station_public_config', 'station_login', 'station_logout', 'station_get_orders', 'station_advance_order', 'station_adjust_prep_time', 'station_log_kitchen_event', 'station_set_table_status', 'station_get_context', 'station_record_payment']);
const OWNER_API = new Set(['advance_order', 'cancel_order', 'adjust_stock', 'patch_settings', 'list_stations', 'upsert_station', 'delete_station', 'record_payment']);

// Values seeded below that must never leave the database through anon RPCs.
const PIN = '4711';
const EMP_PHONE = '+38269111222';
const EMP_EMAIL = 'chef@private.test';
const CUST_PHONE = '+38267555444';
const CUST_ADDR = 'Secret street 42';
const RECIPE_MARK = 'secret-recipe-mark';
const COST = 3.1415;

let db: TestDb;
let a: Tenant;
let b: Tenant;
let kitchenId: string;
let serviceId: string;
let kitchenToken: string;
let serviceToken: string;
let deliveryOrderId: string;
let deliveryReceiptId: string;
let deliveryOrderNumber: number;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, 'sec-a');
  b = await createTenant(db, 'sec-b');
  await db.sql(`INSERT INTO employees(user_id, name, role, phone, email) VALUES ($1,'Chef','Chef',$2,$3)`, [a.userId, EMP_PHONE, EMP_EMAIL]);
  await db.sql(`UPDATE menu_items SET cost_per_serving=$2, recipe=$3::jsonb WHERE id=$1`, [a.soupId, COST, JSON.stringify([{ note: RECIPE_MARK }])]);
  const perms = { canAdvanceOrders: true, canCancelOrders: true, canLogKitchenEvents: true, canAdjustPrepTime: true, canReworkOrders: true, canUpdateTableStatus: true, canRecordPayments: true, visibleStatuses: ['placed', 'preparing', 'ready'] };
  kitchenId = String(((await db.rpc<Res>('authenticated', 'upsert_station', { p_station: { name: 'K', role: 'kitchen', permissions: perms, pin: PIN } }, a.userId)).station as Res).id);
  serviceId = String(((await db.rpc<Res>('authenticated', 'upsert_station', { p_station: { name: 'S', role: 'service', permissions: perms, pin: PIN } }, a.userId)).station as Res).id);
  kitchenToken = String((await db.rpc<Res>('anon', 'station_login', { p_restaurant_token: a.token, p_station_id: kitchenId, p_pin: PIN })).sessionToken);
  serviceToken = String((await db.rpc<Res>('anon', 'station_login', { p_restaurant_token: a.token, p_station_id: serviceId, p_pin: PIN })).sessionToken);
  const r = await db.rpc<Res>('anon', 'atomic_checkout', checkoutArgs(a, [{ menuItemId: a.soupId, quantity: 1 }], {
    p_table_id: 'delivery', p_customer_name: 'Ana', p_customer_phone: CUST_PHONE, p_delivery_address: CUST_ADDR,
  }));
  if (!r.success) throw new Error(String(r.error));
  deliveryOrderId = String(r.orderId);
  deliveryReceiptId = String(r.receiptId);
  [{ order_number: deliveryOrderNumber }] = await db.sql<{ order_number: number }>(`SELECT order_number FROM orders WHERE id=$1`, [deliveryOrderId]);
});
afterAll(async () => { await db?.close(); });

// ── Step 7: function security table ──────────────────────────────────────────

type FnRow = { proname: string; args: string; secdef: boolean; anon_exec: boolean; auth_exec: boolean; search_path: string | null };

async function functionTable(): Promise<FnRow[]> {
  return db.sql<FnRow>(`
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS secdef,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
           (SELECT c FROM unnest(COALESCE(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%') AS search_path
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
     ORDER BY 1, 2`);
}

describe('function security table', () => {
  it('every public-schema function is exactly one of: public API, owner API, internal', async () => {
    const rows = await functionTable();
    expect(rows.length).toBeGreaterThan(30);
    const violations = rows.filter(r => {
      if (PUBLIC_API.has(r.proname)) return !(r.anon_exec && r.auth_exec && r.secdef);
      if (OWNER_API.has(r.proname)) return !(!r.anon_exec && r.auth_exec && r.secdef);
      return r.anon_exec || r.auth_exec; // internal: no API role may execute it
    });
    expect(violations).toEqual([]);
  });

  it('every SECURITY DEFINER function pins search_path to public (optionally + extensions/pg_temp)', async () => {
    const bad = (await functionTable()).filter(r => r.secdef && !/^search_path=("?public"?)(, ?(extensions|pg_temp))*$/.test(r.search_path ?? ''));
    expect(bad).toEqual([]);
  });

  it('there is exactly one overload of every API function (no stale signatures)', async () => {
    const rows = (await functionTable()).filter(r => PUBLIC_API.has(r.proname) || OWNER_API.has(r.proname));
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.proname, (counts.get(r.proname) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n > 1)).toEqual([]);
    expect(new Set(rows.map(r => r.proname))).toEqual(new Set([...PUBLIC_API, ...OWNER_API]));
  });

  it.each(['transition_order_internal', 'record_payment_internal', 'station_require_session', 'station_perm', 'station_public_json', 'checkout_result', 'booking_policy', 'order_transition_allowed_by'])(
    '%s is internal only (anon and authenticated denied)', async fn => {
      const [r] = (await functionTable()).filter(x => x.proname === fn);
      expect(r).toBeTruthy();
      expect({ anon: r.anon_exec, auth: r.auth_exec }).toEqual({ anon: false, auth: false });
    },
  );
});

describe('transition_order_internal regression (migration 021)', () => {
  it('anon cannot call it directly', async () => {
    await expect(db.as('anon', `SELECT transition_order_internal($1, $2, 'placed', 'cancelled', 'x')`, [a.userId, deliveryOrderId]))
      .rejects.toThrow(/permission denied/);
  });

  it('an authenticated owner cannot call it directly, even for their own tenant', async () => {
    await expect(db.as('authenticated', `SELECT transition_order_internal($1, $2, 'placed', 'cancelled', 'x')`, [a.userId, deliveryOrderId], a.userId))
      .rejects.toThrow(/permission denied/);
    const [o] = await db.sql<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [deliveryOrderId]);
    expect(o.status).toBe('placed');
  });

  it('owner B cannot transition or cancel tenant A orders through the owner wrappers', async () => {
    const adv = await db.rpc<Res>('authenticated', 'advance_order', { p_order_id: deliveryOrderId, p_expected_status: 'placed', p_new_status: 'preparing' }, b.userId);
    const cancel = await db.rpc<Res>('authenticated', 'cancel_order', { p_order_id: deliveryOrderId }, b.userId);
    expect([adv.ok, cancel.ok]).toEqual([false, false]);
    const [o] = await db.sql<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [deliveryOrderId]);
    expect(o.status).toBe('placed');
  });

  it('a tenant A station cannot transition tenant B orders', async () => {
    const r = await db.rpc<Res>('anon', 'atomic_checkout', checkoutArgs(b, [{ menuItemId: b.soupId, quantity: 1 }]));
    const res = await db.rpc<Res>('anon', 'station_advance_order', { p_session_token: kitchenToken, p_order_id: r.orderId, p_expected_status: 'placed', p_new_status: 'preparing' });
    expect(res.ok).toBe(false);
    const [o] = await db.sql<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [r.orderId]);
    expect(o.status).toBe('placed');
  });

  it('the trigger blocks direct status UPDATEs that skip the state machine even for the table owner', async () => {
    await expect(db.as('authenticated', `UPDATE orders SET status='completed' WHERE id=$1`, [deliveryOrderId], a.userId)).rejects.toThrow();
  });
});

// ── Step 8: anonymous attack surface ─────────────────────────────────────────

describe('anon direct table access', () => {
  it.each(['orders', 'tables', 'business_settings', 'employees', 'receipts', 'menu_items', 'calendar_events', 'shifts', 'stock_reservations', 'kitchen_events', 'ingredients', 'map_decorations', 'event_packages'])(
    'SELECT %s as anon returns 0 rows', async table => {
      expect(await db.as('anon', `SELECT * FROM ${table}`)).toHaveLength(0);
    },
  );

  it.each(['stations', 'station_sessions'])('SELECT %s as anon is denied', async table => {
    await expect(db.as('anon', `SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/);
  });

  it.each([
    [`INSERT INTO orders(user_id, order_number, items) VALUES ('${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}', 1, '[]')`],
    [`UPDATE orders SET total = 0`],
    [`DELETE FROM receipts`],
    [`UPDATE business_settings SET restaurant_token = 'x'`],
    [`UPDATE menu_items SET price = 0`],
  ])('anon write is rejected or affects nothing: %s', async sql => {
    const before = await db.sql<{ n: number }>(`SELECT (SELECT count(*) FROM orders)::int + (SELECT count(*) FROM receipts)::int AS n`);
    await db.as('anon', sql).catch(() => undefined);
    const after = await db.sql<{ n: number }>(`SELECT (SELECT count(*) FROM orders)::int + (SELECT count(*) FROM receipts)::int AS n`);
    expect(after[0].n).toBe(before[0].n);
    const [s] = await db.sql<{ restaurant_token: string }>(`SELECT restaurant_token FROM business_settings WHERE user_id=$1`, [a.userId]);
    expect(s.restaurant_token).toBe(a.token);
    const [m] = await db.sql<{ price: number }>(`SELECT price::float AS price FROM menu_items WHERE id=$1`, [a.soupId]);
    expect(m.price).toBe(5);
  });
});

describe('anon RPC payloads leak no secrets or PII', () => {
  const FORBIDDEN_KEYS = /"(pin|pin_hash|pinHash|token_hash|tokenHash|session_hash|user_id|userId|cost_per_serving|costPerServing|recipe|customer_phone|customerPhone|delivery_address|deliveryAddress|customer_email|customerEmail|phone|email)"/;

  async function sessionHash(): Promise<string[]> {
    const rows = await db.sql<{ h: string }>(`SELECT encode(token_hash, 'hex') AS h FROM station_sessions`).catch(async () =>
      db.sql<{ h: string }>(`SELECT token_hash::text AS h FROM station_sessions`));
    return rows.map(r => r.h);
  }

  async function publicPayloads(): Promise<Array<[string, unknown]>> {
    return [
      ['get_customer_menu', await db.rpc('anon', 'get_customer_menu', { p_restaurant_token: a.token })],
      ['get_booking_data', await db.rpc('anon', 'get_booking_data', { p_restaurant_token: a.token })],
      ['get_roster_data', await db.rpc('anon', 'get_roster_data', { p_restaurant_token: a.token })],
      ['get_order_status', await db.rpc('anon', 'get_order_status', { p_restaurant_token: a.token, p_order_number: deliveryOrderNumber })],
      ['get_receipt_by_id', await db.rpc('anon', 'get_receipt_by_id', { p_receipt_id: deliveryReceiptId })],
      ['station_public_config', await db.rpc('anon', 'station_public_config', { p_restaurant_token: a.token, p_station_id: kitchenId })],
      ['lookup_booking_status', await db.rpc('anon', 'lookup_booking_status', { p_restaurant_token: a.token, p_phone: CUST_PHONE, p_confirmation_code: 'XXXXXX' })],
      ['atomic_checkout', await db.rpc('anon', 'atomic_checkout', checkoutArgs(a, [{ menuItemId: a.soupId, quantity: 1 }]))],
      ['station_get_context (kitchen)', await db.rpc('anon', 'station_get_context', { p_session_token: kitchenToken })],
      ['station_get_orders (kitchen)', await db.rpc('anon', 'station_get_orders', { p_session_token: kitchenToken })],
    ];
  }

  it('no PIN, pin hash, session hash, employee contact, customer contact, cost, recipe or owner id', async () => {
    const hashes = await sessionHash();
    expect(hashes.length).toBeGreaterThanOrEqual(2); // non-vacuous: both station sessions exist
    const [{ pin_hash }] = await db.sql<{ pin_hash: string }>(`SELECT pin_hash FROM stations WHERE id=$1`, [kitchenId]);
    for (const [name, payload] of await publicPayloads()) {
      const text = JSON.stringify(payload);
      const keysOnly = name.startsWith('station_get_orders') ? text.replace(/"customer_phone":"",|"delivery_address":"",?/g, '') : text;
      expect.soft(keysOnly, name).not.toMatch(FORBIDDEN_KEYS);
      for (const secret of [PIN, pin_hash, EMP_PHONE, EMP_EMAIL, CUST_PHONE, CUST_ADDR, RECIPE_MARK, String(COST), a.userId, ...hashes]) {
        expect.soft(text.includes(secret), `${name} leaks ${secret.slice(0, 12)}`).toBe(false);
      }
    }
  });

  it('the scanner is not vacuous: a planted leak is detected', async () => {
    const hashes = await sessionHash();
    const planted = JSON.stringify({ ok: true, pin_hash: 'x', note: hashes[0] });
    expect(planted).toMatch(FORBIDDEN_KEYS);
    expect(planted.includes(hashes[0])).toBe(true);
    // The owner-only list_stations (authenticated) still must not expose hashes.
    expect(JSON.stringify(await db.rpc('authenticated', 'list_stations', {}, a.userId))).not.toMatch(/pin_hash|token_hash/);
  });

  it('station_login returns the opaque token, never its stored hash', async () => {
    const login = await db.rpc<Res>('anon', 'station_login', { p_restaurant_token: a.token, p_station_id: kitchenId, p_pin: PIN });
    expect(String(login.sessionToken)).toMatch(/^[0-9a-f]{64}$/);
    const text = JSON.stringify(login);
    for (const h of await sessionHash()) expect(text.includes(h)).toBe(false);
    expect(text).not.toMatch(/pin_hash|token_hash|"pin"/);
  });

  it('only service/custom stations receive customer contact for hand-over', async () => {
    const kitchen = JSON.stringify(await db.rpc('anon', 'station_get_orders', { p_session_token: kitchenToken }));
    const service = JSON.stringify(await db.rpc('anon', 'station_get_orders', { p_session_token: serviceToken }));
    expect(kitchen).not.toContain(CUST_PHONE);
    expect(kitchen).not.toContain(CUST_ADDR);
    expect(service).toContain(CUST_ADDR);
  });

  it('an invalid or foreign token gets ok:false and no data from every station RPC', async () => {
    for (const fn of ['station_get_orders', 'station_get_context']) {
      const r = await db.rpc<Res>('anon', fn, { p_session_token: 'f'.repeat(64) });
      expect(r.ok, fn).toBe(false);
      expect(Object.keys(r).sort(), fn).toEqual(['error', 'ok']);
    }
    const cfg = await db.rpc<Res>('anon', 'station_public_config', { p_restaurant_token: b.token, p_station_id: kitchenId });
    expect(cfg.ok).toBe(false);
  });
});
