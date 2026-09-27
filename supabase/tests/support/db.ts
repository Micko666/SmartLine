/**
 * In-process database harness for SmartLine migrations and security tests.
 *
 * PGlite is real Postgres compiled to WASM: RLS, roles, SECURITY DEFINER,
 * triggers and PL/pgSQL behave as in production. It is a single connection,
 * so true parallel-transaction tests need a real server (see docs).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'migrations');

export type Role = 'anon' | 'authenticated' | 'service_role' | 'postgres';

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort();
}

export interface TestDb {
  pg: PGlite;
  /** Run SQL as a Supabase API role; `uid` becomes auth.uid(). */
  as<T = Record<string, unknown>>(role: Role, sql: string, params?: unknown[], uid?: string | null): Promise<T[]>;
  /** Call an RPC as a role and return its JSON result. */
  rpc<T = Record<string, unknown>>(role: Role, fn: string, args: Record<string, unknown>, uid?: string | null): Promise<T>;
  /** Superuser SQL (fixtures and assertions). */
  sql<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

/** @param baseFiles SQL files applied after the shim instead of the repository migrations. */
export async function createTestDb(baseFiles?: string[]): Promise<TestDb> {
  const pg = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await pg.exec(readFileSync(join(__dirname, 'supabase-shim.sql'), 'utf8'));
  for (const file of baseFiles ?? migrationFiles().map(f => join(MIGRATIONS, f))) {
    try {
      await pg.exec(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }

  async function as<T>(role: Role, text: string, params: unknown[] = [], uid: string | null = null): Promise<T[]> {
    await pg.query(`SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)`, [uid ?? '', role]);
    if (role !== 'postgres') await pg.exec(`SET ROLE ${role}`);
    try {
      const result = await pg.query<T>(text, params);
      return result.rows;
    } finally {
      await pg.exec('RESET ROLE');
      await pg.query(`SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)`);
    }
  }

  async function rpc<T>(role: Role, fn: string, args: Record<string, unknown>, uid: string | null = null): Promise<T> {
    const names = Object.keys(args);
    const call = `SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS result`;
    const rows = await as<{ result: T }>(role, call, names.map(n => serialize(args[n])), uid);
    return rows[0].result;
  }

  return {
    pg,
    as,
    rpc,
    sql: (text, params = []) => as('postgres', text, params),
    close: () => pg.close(),
  };
}

function serialize(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}
