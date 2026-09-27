/**
 * Upgrade rehearsal (readiness steps 4 + 5) on a REAL PostgreSQL server.
 *
 *   production pre-state (fixtures/production-pre-015.sql, captured read-only)
 *   + synthetic data shaped like production (same counts/status mix/payment
 *     methods/table_id kinds/legacy station payload) plus edge cases
 *   -> apply 015 ... 024 one by one (each in its own transaction)
 *   -> record duration + affected rows, check postconditions
 *   -> catalog diff: upgraded vs fresh install (shim + 001..024)
 *
 * Runs only with SMARTLINE_PG_URL (npm run test:pg). Writes a JSON report to
 * SMARTLINE_REHEARSAL_REPORT when set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRealDb, REAL_PG_URL, type RealDb } from './support/realdb';
import { migrationFiles } from './support/db';

const MIGRATIONS = resolve(__dirname, '../migrations');
const FIXTURE = resolve(__dirname, 'fixtures/production-pre-015.sql');
const UPGRADE = migrationFiles().filter(f => f >= '015');

type Step = { file: string; ms: number; ok: boolean; error?: string; notices: string[] };
const report: { steps: Step[]; before: Record<string, unknown>; after: Record<string, unknown>; diff: Record<string, { onlyUpgraded: string[]; onlyFresh: string[] }> } =
  { steps: [], before: {}, after: {}, diff: {} };

let up: RealDb;
let fresh: RealDb;
const T1 = randomUUID();
const T2 = randomUUID();
const KITCHEN_STATION = randomUUID();
const SERVICE_STATION = randomUUID();

const TABLES = ['business_settings', 'calendar_events', 'employees', 'event_packages', 'ingredients', 'kitchen_events', 'map_decorations', 'menu_items', 'orders', 'receipts', 'shifts', 'stock_reservations', 'tables'];

async function counts(db: RealDb) {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = (await db.sql<{ n: number }>(`SELECT count(*)::int n FROM ${t}`))[0].n;
  return out;
}

async function money(db: RealDb) {
  const [r] = await db.sql<Record<string, string>>(`SELECT sum(total)::text orders_total, (SELECT sum(total)::text FROM receipts) receipts_total, sum(subtotal)::text orders_subtotal FROM orders`);
  return r;
}

/** Synthetic data mirroring the production distribution observed read-only on 2026-09-27. */
async function seed(db: RealDb) {
  const users = [T1, T2, ...Array.from({ length: 5 }, () => randomUUID())];
  for (const u of users) await db.sql(`INSERT INTO auth.users(id, email) VALUES ($1, $2)`, [u, `${u.slice(0, 8)}@example.test`]);
  const legacyPerms = { canAdvanceOrders: true, canCancelOrders: false, canLogKitchenEvents: true, canAdjustPrepTime: true, canReworkOrders: true, canUpdateTableStatus: false, canEditTableLayout: false, visibleStatuses: ['paid', 'preparing', 'ready'] };
  await db.sql(`INSERT INTO business_settings(user_id, business_name, restaurant_token, timezone, next_order_number, stations, business_hours, calendar_settings)
    VALUES ($1, 'Prod-shaped A', 'tok-a', 'Europe/Paris', 1200, $2::jsonb, NULL, '{"maxEventsPerDay":10}'::jsonb)`,
    [T1, JSON.stringify([{ id: KITCHEN_STATION, name: 'Kitchen', role: 'kitchen', color: '#e8521a', permissions: legacyPerms }])]);
  // Edge tenant: a station with a plaintext PIN and a service role (not in prod, must still migrate safely).
  await db.sql(`INSERT INTO business_settings(user_id, business_name, restaurant_token, timezone, next_order_number, stations)
    VALUES ($1, 'Edge B', 'tok-b', 'Europe/Paris', 1010, $2::jsonb)`,
    [T2, JSON.stringify([{ id: SERVICE_STATION, name: 'Floor', role: 'service', pin: '2468', permissions: { ...legacyPerms, canCancelOrders: true, canUpdateTableStatus: true } }])]);

  const items: string[] = [];
  for (let i = 0; i < 39; i++) {
    const mods = i === 0 ? JSON.stringify([{ id: 'size', name: 'Size', required: true, multiSelect: false, options: [{ id: 'm', name: 'M', priceAdjustment: 0 }, { id: 'l', name: 'L', priceAdjustment: 1.5 }] }]) : '[]';
    const [r] = await db.sql<{ id: string }>(`INSERT INTO menu_items(user_id, name, price, stock, modifiers, cost_per_serving, recipe) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb) RETURNING id`,
      [T1, `Item ${i}`, 4 + i, i % 3 === 0 ? null : 10 + i, mods, i % 5 === 0 ? 1.2 : null, i % 7 === 0 ? '[{"ingredientId":"x","quantity":1}]' : null]);
    items.push(r.id);
  }
  const tables: string[] = [];
  for (let i = 1; i <= 12; i++) tables.push((await db.sql<{ id: string }>(`INSERT INTO tables(user_id, number, name, status) VALUES ($1,$2,$3,$4) RETURNING id`, [T1, i, `Table ${i}`, i <= 2 ? 'occupied' : 'available']))[0].id);

  // 139 production-shaped orders + edge cases ('paid' active, 'served').
  const statuses = [...Array(117).fill('completed'), ...Array(13).fill('cancelled'), ...Array(9).fill('refunded'), 'paid', 'paid', 'served', 'preparing'];
  const methods = ['card', 'cash', 'google_pay', 'apple_pay'];
  for (let i = 0; i < statuses.length; i++) {
    const tableId = i === 0 ? 'takeaway' : i === 1 ? 'delivery' : i < 4 ? 'walk-in' : tables[i % 12];
    const line = { menuItemId: items[i % 39], menuItemName: `Item ${i % 39}`, quantity: 1 + (i % 3), unitPrice: 4 + (i % 39), modifiers: i % 10 === 0 ? [{ groupName: 'Size', optionName: 'L', priceAdjustment: 1.5 }] : [], lineTotal: (4 + (i % 39)) * (1 + (i % 3)) };
    const [o] = await db.sql<{ id: string }>(`INSERT INTO orders(user_id, order_number, table_id, table_name, items, status, subtotal, tax_rate, tax_amount, total, payment_method, scheduled_for, created_at, paid_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,10,$8,$9,$10,$11, now() - ($12 || ' hours')::interval, now() - ($12 || ' hours')::interval) RETURNING id`,
      [T1, 1001 + i, tableId, tableId.length === 36 ? 'Table' : tableId, JSON.stringify([line]), statuses[i], line.lineTotal, +(line.lineTotal * 0.1).toFixed(2), +(line.lineTotal * 1.1).toFixed(2),
       i === 142 ? 'card' : methods[i % 4], i < 2 ? '2026-09-20 12:00' : null, String(i)]);
    await db.sql(`INSERT INTO receipts(user_id, order_id, order_number, table_id, table_name, restaurant_name, items, subtotal, tax_rate, tax_amount, total, payment_method)
      SELECT user_id, id, order_number, table_id, table_name, 'Prod-shaped A', items, subtotal, tax_rate, tax_amount, total, payment_method FROM orders WHERE id=$1`, [o.id]);
  }
  await db.sql(`INSERT INTO employees(user_id, name, role, phone, email) SELECT $1, 'Emp '||g, 'Chef', '+3826900000'||g, 'e'||g||'@example.test' FROM generate_series(1,4) g`, [T1]);
  await db.sql(`INSERT INTO shifts(user_id, date, start_time, end_time, name, assignments) SELECT $1, to_char(now()::date + g, 'YYYY-MM-DD'), '09:00', '17:00', 'Day', '[]' FROM generate_series(1,67) g`, [T1]);
  await db.sql(`INSERT INTO calendar_events(user_id, date, time_slot, type, status, customer_name, customer_phone, guest_count, created_by) VALUES
    ($1, '2026-10-02', '19:00', 'reservation', 'approved', 'Guest', '+38267000001', 2, 'customer'),
    ($1, '2026-10-03', '20:00', 'closure', 'approved', '', '', 1, 'manager')`, [T1]);
  await db.sql(`INSERT INTO map_decorations(user_id, type) SELECT $1, 'plant' FROM generate_series(1,5)`, [T1]);
  await db.sql(`INSERT INTO ingredients(user_id, name, cost_per_unit, stock) VALUES ($1,'Flour',0.002,5000),($1,'Tomato',0.01,2000)`, [T1]);
}

async function applyUpgrade(db: RealDb) {
  for (const file of UPGRADE) {
    const client = await db.pool.connect();
    const notices: string[] = [];
    const onNotice = (n: { message?: string }) => notices.push(String(n.message));
    client.on('notice', onNotice);
    const started = performance.now();
    try {
      await client.query('BEGIN');
      await client.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
      await client.query('COMMIT');
      report.steps.push({ file, ms: Math.round(performance.now() - started), ok: true, notices });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      report.steps.push({ file, ms: Math.round(performance.now() - started), ok: false, error: (e as Error).message, notices });
      break;
    } finally {
      client.off('notice', onNotice);
      client.release();
    }
  }
}

/** Normalized public-schema catalog, one string per object. */
async function catalog(db: RealDb): Promise<Record<string, string[]>> {
  const q = async (sql: string) => (await db.sql<{ x: string }>(sql)).map(r => r.x).sort();
  return {
    columns: await q(`SELECT table_name||'.'||column_name||' '||data_type||' null='||is_nullable||' default='||COALESCE(column_default,'') x FROM information_schema.columns WHERE table_schema='public'`),
    constraints: await q(`SELECT cl.relname||'.'||co.conname||' '||pg_get_constraintdef(co.oid)||' valid='||co.convalidated x FROM pg_constraint co JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace WHERE n.nspname='public'`),
    indexes: await q(`SELECT indexdef x FROM pg_indexes WHERE schemaname='public'`),
    rls: await q(`SELECT relname||' rls='||relrowsecurity||' force='||relforcerowsecurity x FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND relkind='r'`),
    policies: await q(`SELECT tablename||'.'||policyname||' '||cmd||' '||roles::text||' using='||COALESCE(qual,'')||' check='||COALESCE(with_check,'') x FROM pg_policies WHERE schemaname='public'`),
    functions: await q(`SELECT p.proname||'('||pg_get_function_arguments(p.oid)||') -> '||pg_get_function_result(p.oid)||' secdef='||p.prosecdef||' vol='||p.provolatile::text||' cfg='||COALESCE(p.proconfig::text,'')||' anon='||has_function_privilege('anon',p.oid,'EXECUTE')||' auth='||has_function_privilege('authenticated',p.oid,'EXECUTE')||' src='||md5(p.prosrc) x FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname NOT LIKE 'uuid\\_%'`),
    triggers: await q(`SELECT c.relname||' '||pg_get_triggerdef(t.oid) x FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal`),
    grants: await q(`SELECT table_name||' '||grantee||' '||privilege_type x FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee IN ('anon','authenticated','PUBLIC')`),
    publication: await q(`SELECT tablename x FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public'`),
    default_acl: await q(`SELECT COALESCE(n.nspname,'*')||' '||d.defaclobjtype::text||' '||d.defaclacl::text x FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace`),
  };
}

describe.skipIf(!REAL_PG_URL)('upgrade rehearsal: production pre-state -> 015..024', () => {
  beforeAll(async () => {
    const shim = resolve(__dirname, 'support/supabase-shim.sql');
    up = await createRealDb({ baseFiles: [shim, FIXTURE] });
    await seed(up);
    report.before = { counts: await counts(up), money: await money(up),
      statuses: await up.sql(`SELECT status, count(*)::int n FROM orders GROUP BY 1 ORDER BY 1`) };
    await applyUpgrade(up);
    report.after = { counts: await counts(up), money: await money(up),
      statuses: await up.sql(`SELECT status, count(*)::int n FROM orders GROUP BY 1 ORDER BY 1`),
      payment: await up.sql(`SELECT payment_status, count(*)::int n FROM orders GROUP BY 1 ORDER BY 1`),
      channels: await up.sql(`SELECT order_channel, count(*)::int n FROM orders GROUP BY 1 ORDER BY 1`) };
    fresh = await createRealDb();
    const [a, b] = await Promise.all([catalog(up), catalog(fresh)]);
    for (const k of Object.keys(b)) {
      const A = new Set(a[k]); const B = new Set(b[k]);
      report.diff[k] = { onlyUpgraded: a[k].filter(x => !B.has(x)), onlyFresh: b[k].filter(x => !A.has(x)) };
    }
    if (process.env.SMARTLINE_REHEARSAL_REPORT) writeFileSync(process.env.SMARTLINE_REHEARSAL_REPORT, JSON.stringify(report, null, 2));
  }, 600_000);
  afterAll(async () => { await up?.close(); await fresh?.close(); });

  it('every migration 015..024 applies in order on the production-shaped database', () => {
    expect(report.steps.map(s => s.file)).toEqual(UPGRADE);
    expect(report.steps.filter(s => !s.ok)).toEqual([]);
  });

  it('no rows are lost and money totals are unchanged', () => {
    expect(report.after.counts).toEqual(report.before.counts);
    expect(report.after.money).toEqual(report.before.money);
  });

  it('fulfillment backfill: paid -> placed, served -> completed; everything else untouched', () => {
    const after = Object.fromEntries((report.after.statuses as { status: string; n: number }[]).map(r => [r.status, r.n]));
    expect(after).toEqual({ completed: 118, cancelled: 13, refunded: 9, placed: 2, preparing: 1 });
  });

  it('payment backfill: every legacy order is legacy_unverified (never counted as unpaid or as newly paid)', () => {
    expect(report.after.payment).toEqual([{ payment_status: 'legacy_unverified', n: 143 }]);
  });

  it('channel backfill: legacy takeaway/delivery table ids become their channel', () => {
    expect(report.after.channels).toEqual([{ order_channel: 'delivery', n: 1 }, { order_channel: 'dine-in', n: 141 }, { order_channel: 'takeaway', n: 1 }]);
  });

  it('stations: legacy jsonb stations become rows; plaintext PIN hashed and removed; paid -> placed; service can record payments', async () => {
    const rows = await up.sql<{ id: string; role: string; pin_hash: string | null; permissions: Record<string, unknown> }>(`SELECT id, role, pin_hash, permissions FROM stations ORDER BY role`);
    expect(rows.map(r => r.id).sort()).toEqual([KITCHEN_STATION, SERVICE_STATION].sort());
    const kitchen = rows.find(r => r.role === 'kitchen')!;
    const service = rows.find(r => r.role === 'service')!;
    expect(kitchen.pin_hash).toBeNull();
    expect(service.pin_hash).toMatch(/^\$2[aby]\$/);
    expect(kitchen.permissions.visibleStatuses).toEqual(['placed', 'preparing', 'ready']);
    expect(kitchen.permissions.canRecordPayments).toBeUndefined();
    expect(service.permissions.canRecordPayments).toBe(true);
    const [bs] = await up.sql<{ s: string }>(`SELECT stations::text s FROM business_settings WHERE user_id=$1`, [T2]);
    expect(bs.s).not.toContain('2468');
    expect(bs.s).not.toContain('"pin"');
  });

  it('old anon SELECT policies and old RPC overloads are gone', async () => {
    const pol = await up.sql(`SELECT policyname FROM pg_policies WHERE policyname LIKE 'anon_select_%'`);
    expect(pol).toEqual([]);
    const legacy = await up.sql<{ sig: string }>(`SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND pg_get_function_identity_arguments(p.oid) LIKE 'p_restaurant_token text%' AND p.proname LIKE 'station_%' AND p.proname <> 'station_public_config' AND p.proname <> 'station_login'`);
    expect(legacy).toEqual([]);
    const checkouts = await up.sql(`SELECT 1 FROM pg_proc WHERE proname='atomic_checkout'`);
    expect(checkouts).toHaveLength(1);
  });

  it('constraints added NOT VALID were validated against the migrated data', async () => {
    const rows = await up.sql<{ conname: string; convalidated: boolean }>(`SELECT conname, convalidated FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated`);
    expect(rows).toEqual([]);
  });

  it('upgraded schema is identical to a fresh install (catalog diff empty)', () => {
    const nonEmpty = Object.fromEntries(Object.entries(report.diff).filter(([, d]) => d.onlyUpgraded.length || d.onlyFresh.length));
    expect(nonEmpty).toEqual({});
  });

  it('the upgraded database serves the new frontend: checkout continues numbering, tracker and receipt work', async () => {
    const [item] = await up.sql<{ id: string }>(`SELECT id FROM menu_items WHERE user_id=$1 AND stock IS NULL AND modifiers = '[]'::jsonb LIMIT 1`, [T1]);
    const r = await up.rpc<{ success: boolean; orderId: string; receiptId: string; orderNumber: number; error?: string }>('anon', 'atomic_checkout', {
      p_restaurant_token: 'tok-a', p_session_id: 's', p_table_id: 'takeaway', p_payment_method: 'cash', p_cart: [{ menuItemId: item.id, quantity: 1 }],
      p_notes: '', p_scheduled_for: '', p_client_order_id: randomUUID(), p_customer_name: 'A', p_customer_phone: '+38267111111',
    });
    expect(r.success, r.error).toBe(true);
    const [o] = await up.sql<{ order_number: number; status: string; payment_status: string }>(`SELECT order_number, status, payment_status FROM orders WHERE id=$1`, [r.orderId]);
    expect(o).toEqual({ order_number: 1200, status: 'placed', payment_status: 'unpaid' });
    const tracker = await up.rpc<Record<string, unknown>>('anon', 'get_order_status', { p_restaurant_token: 'tok-a', p_order_number: 1200 });
    expect(tracker).toMatchObject({ ok: true, status: 'placed', paymentStatus: 'unpaid' });
    const receipt = await up.rpc<Record<string, unknown>>('anon', 'get_receipt_by_id', { p_receipt_id: r.receiptId });
    expect(receipt.ok).toBe(true);
    const menu = await up.rpc<{ ok?: boolean; menuItems?: unknown[] }>('anon', 'get_customer_menu', { p_restaurant_token: 'tok-a' });
    expect(JSON.stringify(menu)).not.toMatch(/cost_per_serving|costPerServing|recipe/);
    const legacyTracker = await up.rpc<Record<string, unknown>>('anon', 'get_order_status', { p_restaurant_token: 'tok-a', p_order_number: 1001 + 139 });
    expect(legacyTracker).toMatchObject({ ok: true, status: 'placed', paymentStatus: 'legacy_unverified' });
    const login = await up.rpc<{ ok: boolean }>('anon', 'station_login', { p_restaurant_token: 'tok-b', p_station_id: SERVICE_STATION, p_pin: '2468' });
    expect(login.ok).toBe(true);
  });
});
