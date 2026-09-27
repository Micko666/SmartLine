/**
 * Client ↔ database RPC contract checker (used by client-contract.test.ts).
 * Pure extraction + a DB check that returns violations instead of asserting,
 * so its ability to fail can be tested with negative fixtures.
 */
import type { TestDb } from './db';

export interface RpcCall { file: string; fn: string; args: string[] }
export type ApiRole = 'anon' | 'authenticated';

/** Index just past the bracket that closes the one at `start`. */
function skipBalanced(code: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close && --depth === 0) return i + 1;
  }
  return code.length;
}

/**
 * supabase.rpc('fn', {...}) and the thin wrappers rpc('fn', {...}) / call('fn', {...}),
 * including generic type arguments and nested objects in the argument literal.
 * Only top-level `p_*` keys of the argument object are RPC parameter names.
 */
export function extractRpcCalls(code: string, file: string): RpcCall[] {
  const calls: RpcCall[] = [];
  for (const m of code.matchAll(/\b(?:rpc|call)\b/g)) {
    let i = m.index! + m[0].length;
    if (code[i] === '<') i = skipBalanced(code, i, '<', '>');
    if (code[i] !== '(') continue;
    const head = /^\(\s*'([a-z_]+)'\s*(,\s*)?/.exec(code.slice(i));
    if (!head) continue;
    const args: string[] = [];
    const objStart = i + head[0].length;
    if (head[2] && code[objStart] === '{') {
      const literal = code.slice(objStart, skipBalanced(code, objStart, '{', '}'));
      let depth = 0;
      for (let k = 0; k < literal.length; k++) {
        const ch = literal[k];
        if ('{(['.includes(ch)) depth++;
        else if ('})]'.includes(ch)) depth--;
        else if (depth === 1) {
          const key = /^(p_[a-z_]+)\s*:/.exec(literal.slice(k));
          if (key && !/[A-Za-z0-9_]/.test(literal[k - 1])) { args.push(key[1]); k += key[1].length; }
        }
      }
    }
    calls.push({ file, fn: head[1], args });
  }
  return calls;
}

/** Owner calls go through workspaceService (signed-in session); everything else runs as anon. */
export function callerRole(file: string): ApiRole {
  return /workspaceService/.test(file) ? 'authenticated' : 'anon';
}

export async function contractViolations(db: TestDb, call: RpcCall, role: ApiRole = callerRole(call.file)): Promise<string[]> {
  const fns = await db.sql<{ args: string[] | null; modes: string[] | null; ndefaults: number; exec: boolean }>(`
    SELECT p.proargnames AS args, p.proargmodes::text[] AS modes, p.pronargdefaults AS ndefaults,
           has_function_privilege($2, p.oid, 'EXECUTE') AS exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = $1`, [call.fn, role]);
  if (fns.length === 0) return [`function ${call.fn} does not exist`];
  // PostgREST picks the overload whose parameter names fit the supplied
  // arguments; zero fits is an error, more than one is PGRST203 (ambiguous).
  const perCandidate = fns.map(f => {
    const out: string[] = [];
    const params = (f.args ?? []).filter((_, i) => !f.modes || f.modes[i] === 'i');
    for (const a of call.args) if (!params.includes(a)) out.push(`${call.fn} has no parameter ${a}`);
    const required = params.slice(0, params.length - f.ndefaults);
    for (const r of required) if (!call.args.includes(r)) out.push(`${call.fn}: required ${r} not passed`);
    return { out, exec: f.exec };
  });
  const fitting = perCandidate.filter(c => c.out.length === 0);
  if (fitting.length > 1) return [`function ${call.fn}: ${fitting.length} overloads fit the call; PostgREST resolution is ambiguous`];
  if (fitting.length === 1) return fitting[0].exec ? [] : [`${call.fn} is not executable by ${role}`];
  return perCandidate.sort((a, b) => a.out.length - b.out.length)[0].out;
}

export interface TableOp { file: string; table: string; op: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' }

/** `.from('table')` chains (possibly multi-line) and the first CRUD verb that follows. `.upsert` needs INSERT + UPDATE. */
export function extractTableOps(code: string, file: string): TableOp[] {
  const ops: TableOp[] = [];
  for (const m of code.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)) {
    const rest = code.slice(m.index! + m[0].length, m.index! + m[0].length + 400);
    const verb = /^\s*\.(select|insert|update|upsert|delete)\s*\(/.exec(rest)?.[1];
    if (!verb) continue;
    if (verb === 'upsert') ops.push({ file, table: m[1], op: 'INSERT' }, { file, table: m[1], op: 'UPDATE' });
    else ops.push({ file, table: m[1], op: verb.toUpperCase() as TableOp['op'] });
  }
  return ops;
}

/** Customer, station and public pages run without a session (anon); everything else as the signed-in owner. */
export function tableRole(file: string): ApiRole {
  return /(pages[\\/](customer|station)|queries[\\/]public|stationService|bookingService)/.test(file) ? 'anon' : 'authenticated';
}

export async function tableViolations(db: TestDb, op: TableOp, role: ApiRole = tableRole(op.file)): Promise<string[]> {
  const [t] = await db.sql<{ exists: boolean }>(`SELECT to_regclass('public.' || $1) IS NOT NULL AS exists`, [op.table]);
  if (!t.exists) return [`table ${op.table} does not exist`];
  const [p] = await db.sql<{ ok: boolean }>(`SELECT has_table_privilege($1, 'public.' || $2, $3) AS ok`, [role, op.table, op.op]);
  return p.ok ? [] : [`${role} has no ${op.op} on ${op.table}`];
}
