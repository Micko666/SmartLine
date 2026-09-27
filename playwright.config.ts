import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // e2e/preview runs against a dev Supabase project: playwright.preview.config.ts
  testIgnore: ['preview/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The Vite dev server compiles on demand; more workers made first loads flaky.
  workers: 2,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Europe/Podgorica',
  },
  // CI installs Playwright's Chromium. Locally, PW_CHANNEL=chrome reuses an
  // installed Google Chrome instead of downloading a browser.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL || undefined } }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
    timeout: 120_000,
  },
});
