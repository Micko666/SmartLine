/**
 * Frontend x database deployment compatibility matrix (readiness step 11).
 *
 *   frontend: NEW = src/ (this checkout)      OLD = production frontend source
 *   database: NEW = shim + 001..024           OLD = production pre-015 schema
 *                                                   (fixtures/production-pre-015.sql)
 *
 * For each cell, every RPC call and direct table operation in the frontend is
 * checked against the database with the same contract checker as
 * client-contract.test.ts. OLD frontend runs only when SMARTLINE_OLD_SRC
 * points at an extracted copy of it (e.g. `git archive origin/master src`).
 * Writes the full violation lists to SMARTLINE_COMPAT_REPORT when set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createTestDb, migrationFiles, type TestDb } from './support/db';
import { contractViolations, extractRpcCalls, extractTableOps, tableViolations } from './support/contract';

const NEW_SRC = resolve(__dirname, '../../src');
const OLD_SRC = process.env.SMARTLINE_OLD_SRC ? resolve(process.env.SMARTLINE_OLD_SRC) : '';
const PROD_PRE = [resolve(__dirname, 'fixtures/production-pre-015.sql')];
const UPGRADE = migrationFiles().filter(f => f >= '015').map(f => resolve(__dirname, '../migrations', f));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'tests' ? [] : files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

async function violations(srcDir: string, db: TestDb): Promise<string[]> {
  const out: string[] = [];
  for (const file of files(srcDir)) {
    const code = readFileSync(file, 'utf8');
    const rel = relative(srcDir, file);
    for (const call of extractRpcCalls(code, rel)) for (const v of await contractViolations(db, call)) out.push(`${rel}: ${v}`);
    for (const op of extractTableOps(code, rel)) for (const v of await tableViolations(db, op)) out.push(`${rel}: ${v}`);
  }
  return [...new Set(out)].sort();
}

let newDb: TestDb;
let oldDb: TestDb;
const matrix: Record<string, string[]> = {};

beforeAll(async () => {
  [newDb, oldDb] = await Promise.all([createTestDb(), createTestDb(PROD_PRE)]);
});
afterAll(async () => {
  if (process.env.SMARTLINE_COMPAT_REPORT) writeFileSync(process.env.SMARTLINE_COMPAT_REPORT, JSON.stringify(matrix, null, 2));
  await Promise.all([newDb?.close(), oldDb?.close()]);
});

describe('deployment compatibility matrix', () => {
  it('NEW frontend + NEW database: fully compatible', async () => {
    matrix['new-fe/new-db'] = await violations(NEW_SRC, newDb);
    expect(matrix['new-fe/new-db']).toEqual([]);
  });

  it('NEW frontend + OLD (production) database: incompatible -> never deploy the frontend first', async () => {
    matrix['new-fe/old-db'] = await violations(NEW_SRC, oldDb);
    expect(matrix['new-fe/old-db'].join('\n')).toMatch(/atomic_checkout has no parameter p_client_order_id/);
    expect(matrix['new-fe/old-db'].join('\n')).toMatch(/station_login does not exist/);
  });

  it.skipIf(!OLD_SRC)('OLD frontend + OLD database: compatible (validates the production schema capture)', async () => {
    matrix['old-fe/old-db'] = await violations(join(OLD_SRC, 'src'), oldDb);
    expect(matrix['old-fe/old-db']).toEqual([]);
  });

  it.skipIf(!OLD_SRC)('OLD frontend + NEW database: incompatible -> the frontend must switch right after the migrations', async () => {
    matrix['old-fe/new-db'] = await violations(join(OLD_SRC, 'src'), newDb);
    expect(matrix['old-fe/new-db'].length).toBeGreaterThan(0);
  });
});

/**
 * Partial-upgrade states: production pre-state + 015..N. Shows what each
 * frontend can do if migration N succeeded and N+1 failed (each file is one
 * transaction, so a failed file leaves the database exactly at state N).
 */
describe('intermediate upgrade states (N applied, N+1 failed)', () => {
  it('new frontend is fully compatible only after 024; counts per state are recorded', async () => {
    const steps: Record<string, { newFe: number; oldFe?: number }> = {};
    for (let n = 1; n <= UPGRADE.length; n++) {
      const db = await createTestDb([...PROD_PRE, ...UPGRADE.slice(0, n)]);
      try {
        const label = basename(UPGRADE[n - 1]).slice(0, 3);
        steps[label] = { newFe: (await violations(NEW_SRC, db)).length };
        if (OLD_SRC) steps[label].oldFe = (await violations(join(OLD_SRC, 'src'), db)).length;
      } finally { await db.close(); }
    }
    matrix['intermediate'] = Object.entries(steps).map(([k, v]) => `${k}: new-fe ${v.newFe} violations${v.oldFe === undefined ? '' : `, old-fe ${v.oldFe} violations`}`);
    const labels = Object.keys(steps);
    expect(labels).toHaveLength(UPGRADE.length);
    expect(steps[labels[labels.length - 1]].newFe).toBe(0);
    expect(labels.slice(0, -1).every(l => steps[l].newFe > 0)).toBe(true);
  }, 300_000);
});
