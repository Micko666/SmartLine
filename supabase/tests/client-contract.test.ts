/**
 * Client ↔ database contract: every `supabase.rpc('fn', { p_... })` call in
 * src/ must match a function in the replayed schema — same name, only real
 * parameter names, every parameter without a default supplied, and EXECUTE
 * granted to the role that calls it. Catches silent breakage when a migration
 * renames or drops an RPC argument.
 *
 * The negative fixtures prove the checker can fail: each one is a call shape
 * that would break in production and must produce a violation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createTestDb, type TestDb } from './support/db';
import { contractViolations, extractRpcCalls, type RpcCall } from './support/contract';

const SRC = resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'tests' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function rpcCalls(): RpcCall[] {
  return sourceFiles(SRC).flatMap(file => extractRpcCalls(readFileSync(file, 'utf8'), relative(SRC, file)));
}

let db: TestDb;
beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe('frontend RPC calls match the migrated schema', () => {
  const calls = rpcCalls();

  it('finds the RPC call sites', () => {
    expect(calls.length).toBeGreaterThan(20);
  });

  it.each(calls.map(c => [`${c.fn} (${c.file})`, c] as const))('%s', async (_label, call) => {
    expect(await contractViolations(db, call)).toEqual([]);
  });
});

describe('contract checker fails on broken calls (negative fixtures)', () => {
  it('extracts names, generic calls and only top-level p_ keys', () => {
    const code = `
      await supabase.rpc('get_order_status', { p_restaurant_token: t, p_order_number: n });
      await call<{ ok: boolean }>('station_get_orders', { p_session_token: tok, nested: { p_fake: 1 } });
      const x = rpc('submit_booking', { ...base, p_notes: '' });`;
    expect(extractRpcCalls(code, 'x.ts')).toEqual([
      { file: 'x.ts', fn: 'get_order_status', args: ['p_restaurant_token', 'p_order_number'] },
      { file: 'x.ts', fn: 'station_get_orders', args: ['p_session_token'] },
      { file: 'x.ts', fn: 'submit_booking', args: ['p_notes'] },
    ]);
  });

  it.each<[string, RpcCall, RegExp]>([
    ['nonexistent RPC', { file: 'pages/customer/X.tsx', fn: 'get_orders_v2', args: [] }, /does not exist/],
    ['wrong argument name', { file: 'pages/customer/OrderTracker.tsx', fn: 'get_order_status', args: ['p_token', 'p_order_number'] }, /no parameter p_token/],
    ['missing required argument', { file: 'pages/customer/OrderTracker.tsx', fn: 'get_order_status', args: ['p_restaurant_token'] }, /required p_order_number not passed/],
    ['stale argument (removed p_status from submit_booking)', {
      file: 'lib/supabase/queries/public.ts', fn: 'submit_booking',
      args: ['p_restaurant_token', 'p_client_request_id', 'p_date', 'p_time_slot', 'p_type', 'p_customer_name', 'p_customer_phone', 'p_customer_email', 'p_guest_count', 'p_package_id', 'p_notes', 'p_status'],
    }, /no parameter p_status/],
    ['no EXECUTE for the caller role (owner RPC called from a public page)', { file: 'pages/customer/Menu.tsx', fn: 'record_payment', args: ['p_order_id'] }, /not executable by anon/],
    ['internal helper called from the client', { file: 'services/workspaceService.ts', fn: 'transition_order_internal', args: ['p_user_id', 'p_order_id', 'p_expected_status', 'p_new_status', 'p_actor'] }, /not executable by authenticated/],
  ])('%s', async (_name, call, expected) => {
    const violations = await contractViolations(db, call);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.join('\n')).toMatch(expected);
  });

  it('an overloaded function is reported as ambiguous', async () => {
    await db.sql(`CREATE FUNCTION public.get_order_status(p_restaurant_token text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`);
    try {
      const v = await contractViolations(db, { file: 'pages/customer/OrderTracker.tsx', fn: 'get_order_status', args: ['p_restaurant_token', 'p_order_number'] });
      expect(v.join('\n')).toMatch(/overloaded/);
    } finally {
      await db.sql(`DROP FUNCTION public.get_order_status(text)`);
    }
  });
});
