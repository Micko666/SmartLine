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
