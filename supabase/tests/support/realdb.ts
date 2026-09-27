/**
 * Real PostgreSQL server harness (multi-connection) for concurrency tests.
 *
 * Enabled only when SMARTLINE_PG_URL points at a disposable development
 * server (e.g. postgres://postgres:pw@127.0.0.1:55432/postgres). Each run
 * creates a fresh database, applies the Supabase shim + every migration, and
 * drops the database afterwards. Never point this at a Supabase project:
 * the shim creates roles and auth objects that the platform owns.
 *
 * Every RPC runs the way PostgREST runs it: its own connection from a pool,
 * BEGIN; SET LOCAL ROLE <role>; set_config(jwt claims, local); SELECT fn(...); COMMIT.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrationFiles, type Role } from './db';

const MIGRATIONS = resolve(__dirname, '../../migrations');

export const REAL_PG_URL = process.env.SMARTLINE_PG_URL ?? '';

export interface RealDb {
  pool: pg.Pool;
  name: string;
  sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** One PostgREST-style RPC transaction on its own pooled connection. */
  rpc<T = Record<string, unknown>>(role: Role, fn: string, args: Record<string, unknown>, uid?: string | null): Promise<T>;
  /** A dedicated connection with an open transaction as `role` (for held-lock tests). */
  begin(role: Role, uid?: string | null): Promise<RealTx>;
  close(): Promise<void>;
}

export interface RealTx {
  client: pg.PoolClient;
  call<T = Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  pid: number;
}

function serialize(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) return JSON.stringify(value);
  return value;
}

function callSql(fn: string, args: Record<string, unknown>) {
  const names = Object.keys(args);
  return { text: `SELECT ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) AS result`, values: names.map(n => serialize(args[n])) };
}

async function asRole(client: pg.PoolClient, role: Role, uid: string | null) {
  if (role !== 'postgres') await client.query(`SET LOCAL ROLE ${role}`);
  await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [uid ?? '', role]);
}

export async function createRealDb(): Promise<RealDb> {
  if (!REAL_PG_URL) throw new Error('SMARTLINE_PG_URL not set');
  if (/supabase\.(co|com)/.test(REAL_PG_URL)) throw new Error('Refusing to run the real-PG harness against a Supabase host');
  const name = `smartline_it_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new pg.Client({ connectionString: REAL_PG_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name} TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`);
  await admin.end();

  const url = new URL(REAL_PG_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  const setup = await pool.connect();
  try {
    await setup.query(readFileSync(join(__dirname, 'supabase-shim.sql'), 'utf8'));
    for (const file of migrationFiles()) {
      try {
        await setup.query(readFileSync(join(MIGRATIONS, file), 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${file} failed on real PostgreSQL: ${(error as Error).message}`);
      }
    }
  } finally {
    setup.release();
  }

  const sql = async <T>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

  async function rpc<T>(role: Role, fn: string, args: Record<string, unknown>, uid: string | null = null): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await asRole(client, role, uid);
      const q = callSql(fn, args);
      const r = await client.query(q.text, q.values);
      await client.query('COMMIT');
      return r.rows[0].result as T;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async function begin(role: Role, uid: string | null = null): Promise<RealTx> {
    const client = await pool.connect();
    await client.query('BEGIN');
    await asRole(client, role, uid);
    const [{ pid }] = (await client.query('SELECT pg_backend_pid() AS pid')).rows as { pid: number }[];
    let done = false;
    const finish = async (cmd: string) => { if (done) return; done = true; try { await client.query(cmd); } finally { client.release(); } };
    return {
      client, pid,
      async call<T>(fn: string, args: Record<string, unknown>) { const q = callSql(fn, args); return (await client.query(q.text, q.values)).rows[0].result as T; },
      commit: () => finish('COMMIT'),
      rollback: () => finish('ROLLBACK'),
    };
  }

  return {
    pool, name, sql, rpc, begin,
    async close() {
      await pool.end();
      const a = new pg.Client({ connectionString: REAL_PG_URL });
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
