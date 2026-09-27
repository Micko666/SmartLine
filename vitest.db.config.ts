import { defineConfig } from 'vitest/config';
import path from 'path';

/** Database migration + RLS/RPC security tests (in-process PGlite, no Docker). */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['supabase/tests/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
