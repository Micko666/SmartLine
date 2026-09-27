import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './support/db';

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe('migration chain', () => {
  it('replays every repository migration on an empty database', async () => {
    const tables = await db.sql<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`);
    expect(tables.map(t => t.tablename)).toEqual(expect.arrayContaining([
      'business_settings', 'calendar_events', 'employees', 'event_packages', 'ingredients', 'kitchen_events',
      'map_decorations', 'menu_items', 'orders', 'receipts', 'shifts', 'stock_reservations', 'tables',
    ]));
  });
});

import prod from './fixtures/production-schema-2026-09-27.json';

describe('production parity (read-only snapshot of prod catalog, 2026-09-27)', () => {
  it('every production column exists locally with the same type and nullability', async () => {
    const rows = await db.sql<{ c: string }>(`SELECT table_name||'.'||column_name||':'||udt_name||':'||is_nullable AS c FROM information_schema.columns WHERE table_schema='public'`);
    const local = new Set(rows.map(r => r.c));
    expect(prod.columns.filter(c => !local.has(c))).toEqual([]);
  });

  it('every production index and realtime publication member exists locally', async () => {
    const idx = new Set((await db.sql<{ n: string }>(`SELECT indexname n FROM pg_indexes WHERE schemaname='public'`)).map(r => r.n));
    expect(prod.indexes.filter(i => !idx.has(i))).toEqual([]);
    const pub = (await db.sql<{ t: string }>(`SELECT tablename t FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY 1`)).map(r => r.t);
    expect(pub).toEqual(expect.arrayContaining(prod.publication));
  });
});

describe('data constraints', () => {
  it('every CHECK/UNIQUE added by the stabilization is validated', async () => {
    const rows = await db.sql<{ conname: string; convalidated: boolean }>(`SELECT conname, convalidated FROM pg_constraint
      WHERE conname IN ('menu_nonnegative','booking_positive_guests','package_guest_range','orders_payment_method','orders_payment_state','orders_channel','orders_status_check')`);
    expect(rows).toHaveLength(7);
    expect(rows.filter(r => !r.convalidated)).toEqual([]);
    const [idx] = await db.sql<{ n: number }>(`SELECT count(*)::int n FROM pg_indexes WHERE indexname='orders_user_number'`);
    expect(idx.n).toBe(1);
  });

  it('rejects negative stock and duplicate order numbers at the database level', async () => {
    const [{ id: user }] = await db.sql<{ id: string }>(`INSERT INTO auth.users(id) VALUES (gen_random_uuid()) RETURNING id`);
    await expect(db.sql(`INSERT INTO menu_items(user_id, name, price, stock) VALUES ($1,'x',1,-1)`, [user])).rejects.toThrow();
    await db.sql(`INSERT INTO orders(user_id, order_number, items) VALUES ($1, 5, '[]')`, [user]);
    await expect(db.sql(`INSERT INTO orders(user_id, order_number, items) VALUES ($1, 5, '[]')`, [user])).rejects.toThrow();
  });
});
