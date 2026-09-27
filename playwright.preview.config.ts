import { defineConfig, devices } from '@playwright/test';

/**
 * Preview E2E against a DEVELOPMENT Supabase project (never production).
 *   PREVIEW_SUPABASE_URL / PREVIEW_SUPABASE_ANON_KEY  dev project API
 *   PREVIEW_TOKEN                                     seeded restaurant token
 * Run: PW_CHANNEL=chrome npx playwright test -c playwright.preview.config.ts
 */
const url = process.env.PREVIEW_SUPABASE_URL ?? '';
if (/bcwlizkhceidumyaygda/.test(url)) throw new Error('Refusing to run preview E2E against the production project');

export default defineConfig({
  testDir: './e2e/preview',
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 15_000 },
  timeout: 90_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8090',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Europe/Paris',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 8090 --strictPort',
    url: 'http://127.0.0.1:8090',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: process.env.PREVIEW_SUPABASE_ANON_KEY ?? '' },
    timeout: 120_000,
  },
});
