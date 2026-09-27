/**
 * Client ↔ database contract: every `supabase.rpc('fn', { p_... })` call in
 * src/ must match a function in the replayed schema — same name, only real
 * parameter names, every parameter without a default supplied, and EXECUTE
 * granted to the role that calls it. Catches silent breakage when a migration
 * renames or drops an RPC argument.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createTestDb, type TestDb } from './support/db';

const SRC = resolve(__dirname, '../../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'tests' ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

interface Call { file: string; fn: string; args: string[] }

/** Index just past the bracket that closes the one at `start`. */
function skipBalanced(code: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === open) depth++;
    else if (code[i] === close && --depth === 0) return i + 1;
  }
  return code.length;
}

function rpcCalls(): Call[] {
  const calls: Call[] = [];
  for (const file of sourceFiles(SRC)) {
    const code = readFileSync(file, 'utf8');
    // supabase.rpc('fn', {...}) and the thin wrappers rpc('fn', {...}) / call('fn', {...}),
    // including generic type arguments and nested objects in the argument literal.
    for (const m of code.matchAll(/\b(?:rpc|call)\b/g)) {
      let i = m.index! + m[0].length;
      if (code[i] === '<') i = skipBalanced(code, i, '<', '>');
      if (code[i] !== '(') continue;
      const head = /^\(\s*'([a-z_]+)'\s*(,\s*)?/.exec(code.slice(i));
      if (!head) continue;
      let args: string[] = [];
      const objStart = i + head[0].length;
      if (head[2] && code[objStart] === '{') {
        const literal = code.slice(objStart, skipBalanced(code, objStart, '{', '}'));
        // Only top-level keys of the argument object are RPC parameter names.
        let depth = 0;
        const top: string[] = [];
        for (let k = 0; k < literal.length; k++) {
          const ch = literal[k];
          if ('{([' .includes(ch)) depth++;
          else if ('})]'.includes(ch)) depth--;
          else if (depth === 1) {
            const key = /^(p_[a-z_]+)\s*:/.exec(literal.slice(k));
            if (key && !/[A-Za-z0-9_]/.test(literal[k - 1])) { top.push(key[1]); k += key[1].length; }
          }
        }
        args = top;
      }
      calls.push({ file: relative(SRC, file), fn: head[1], args });
    }
  }
  return calls;
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
    const fns = await db.sql<{ args: string[] | null; modes: string[] | null; ndefaults: number; anon: boolean; auth: boolean }>(`
      SELECT p.proargnames AS args, p.proargmodes::text[] AS modes, p.pronargdefaults AS ndefaults,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1`, [call.fn]);
    expect(fns, `function ${call.fn} does not exist`).toHaveLength(1);
    const f = fns[0];
    const params = (f.args ?? []).filter((_, i) => !f.modes || f.modes[i] === 'i');
    for (const a of call.args) expect(params, `${call.fn} has no parameter ${a}`).toContain(a);
    const required = params.slice(0, params.length - f.ndefaults);
    for (const r of required) expect(call.args, `${call.fn}: required ${r} not passed`).toContain(r);
    expect(f.anon || f.auth, `${call.fn} is not executable by API roles`).toBe(true);
  });
});
