/**
 * Customer + station flows against a real development Supabase project
 * (migrated with 015-024). Every test fails on any uncaught page error,
 * console error, or failed Supabase response (PostgREST 4xx/5xx, RPC
 * signature mismatch PGRST202/203, RLS denial 42501).
 *
 * Owner/admin flows are not automated here: they need a password sign-in
 * against the remote auth host, which is done manually (see
 * docs/production-release-readiness.md).
 */
import { expect, test, type Page } from '@playwright/test';

const SUPABASE = process.env.PREVIEW_SUPABASE_URL ?? '';
const KEY = process.env.PREVIEW_SUPABASE_ANON_KEY ?? '';
const TOKEN = process.env.PREVIEW_TOKEN ?? 'dev-token-a';
const KITCHEN = '22222222-2222-4222-8222-222222222222';
const SERVICE = '33333333-3333-4333-8333-333333333333';

test.skip(!SUPABASE || !KEY, 'PREVIEW_SUPABASE_URL / PREVIEW_SUPABASE_ANON_KEY not set');

type Problem = { kind: string; detail: string };
let problems: Problem[] = [];

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on('pageerror', e => problems.push({ kind: 'pageerror', detail: e.message }));
  page.on('console', m => { if (m.type() === 'error') problems.push({ kind: 'console', detail: m.text() }); });
  page.on('response', async r => {
    if (!r.url().startsWith(SUPABASE) || r.status() < 400) return;
    problems.push({ kind: `http ${r.status()}`, detail: `${r.request().method()} ${r.url().replace(SUPABASE, '')} ${(await r.text().catch(() => '')).slice(0, 300)}` });
  });
});

// Playwright hooks take the fixtures object first; this hook needs none.
// eslint-disable-next-line no-empty-pattern
test.afterEach(async ({}, info) => {
  await info.attach('problems', { body: JSON.stringify(problems, null, 2), contentType: 'application/json' });
  expect(problems, 'uncaught errors / failed Supabase calls').toEqual([]);
});

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SUPABASE}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args),
  });
  return r.json() as Promise<T>;
}

type MenuItemRow = { id: string; name: string; stock: number | null; modifiers: { required?: boolean }[] };

/** Any orderable item: the dev data is edited by hand, so tests must not depend on one item. */
async function pickItem(): Promise<MenuItemRow> {
  const menu = await rpc<{ menuItems: MenuItemRow[] }>('get_customer_menu', { p_restaurant_token: TOKEN });
  const item = menu.menuItems.find(m => (m.stock === null || m.stock >= 5) && !(m.modifiers ?? []).some(g => g.required));
  if (!item) throw new Error('Dev menu has no active item without required modifiers and with stock >= 5');
  return item;
}

async function addSoupAndPay(page: Page) {
  const item = await pickItem();
  await page.getByRole('heading', { name: item.name, exact: true }).first().click();
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.getByRole('button', { name: /view cart/i }).click();
  await page.getByRole('button', { name: /proceed to payment/i }).click();
}

test('public anon surface: direct table reads return nothing', async () => {
  for (const table of ['orders', 'tables', 'business_settings', 'employees', 'receipts', 'stations', 'station_sessions']) {
    const r = await fetch(`${SUPABASE}/rest/v1/${table}?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    const body = await r.json();
    // 200 [] under RLS, or 401/403/404 when the role has no privilege at all.
    expect(r.status === 200 ? body : [], `${table}: ${r.status}`).toEqual([]);
  }
});

test('dine-in: menu -> cart -> place order -> receipt -> tracker', async ({ page }) => {
  const menu = await rpc<{ tables: { id: string; name: string }[] }>('get_customer_menu', { p_restaurant_token: TOKEN });
  const table = menu.tables[0];
  await page.goto(`/menu?t=${table.id}&r=${TOKEN}`);
  await addSoupAndPay(page);
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\//);
  await expect(page.getByText(/Payment due at restaurant/)).toBeVisible();
  await expect(page.getByRole('link', { name: /order more/i })).toHaveAttribute('href', `/menu?t=${table.id}&r=${TOKEN}`);
  const orderNumber = Number((await page.getByText(/#\d{4}/).first().textContent())?.match(/\d{4}/)?.[0]);
  await page.goto(`/track?r=${TOKEN}&n=${orderNumber}`);
  await expect(page.getByText('Order Received')).toBeVisible();
  await expect(page.getByText(/NaN/)).toHaveCount(0);
});

test('takeaway: portal schedule -> menu -> order -> receipt', async ({ page }) => {
  await page.goto(`/order/${TOKEN}`);
  await page.getByRole('button', { name: /takeaway/i }).click();
  await page.getByRole('button', { name: /browse menu/i }).click();
  await expect(page).toHaveURL(/mode=takeaway/);
  await addSoupAndPay(page);
  await page.getByPlaceholder('Full name *').fill('Preview Guest');
  await page.getByPlaceholder('Phone number *').fill('+382 67 000 111');
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\/.*mode=takeaway/);
});

test('delivery: address stays out of the URL; order lands on receipt', async ({ page }) => {
  await page.goto(`/order/${TOKEN}`);
  await page.getByRole('button', { name: /delivery/i }).click();
  await page.getByPlaceholder('Street, city, postcode').fill('Preview street 1, Podgorica');
  await page.getByRole('button', { name: /browse menu/i }).click();
  await expect(page).toHaveURL(/mode=delivery/);
  expect(page.url()).not.toContain('Preview');
  await addSoupAndPay(page);
  await page.getByPlaceholder('Full name *').fill('Preview Guest');
  await page.getByPlaceholder('Phone number *').fill('+382 67 000 222');
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\/.*mode=delivery/);
  expect(page.url()).not.toContain('Preview');
});

test('booking: request gets a confirmation code', async ({ page }) => {
  await page.goto(`/book/${TOKEN}`);
  await page.getByRole('button', { name: /just a group booking/i }).click();
  const day = page.locator('button[data-date]:not([disabled])').first();
  await day.click();
  await page.getByRole('button', { name: /^\d{2}:00$/ }).first().click();
  await page.getByLabel(/Full name/).fill('Preview Guest');
  await page.getByLabel(/Phone/).fill('+382 67 000 333');
  await page.getByRole('button', { name: /send .*request/i }).click();
  await expect(page.getByTestId('confirmation-code')).toHaveText(/^[0-9A-F]{8}$/);
});

test('roster page renders without contact data', async ({ page }) => {
  await page.goto(`/roster/${TOKEN}`);
  await expect(page.getByText('Chef Dev')).toBeVisible();
  await expect(page.getByText('+38269000999')).toHaveCount(0);
  await expect(page.getByText('chef-dev@example.test')).toHaveCount(0);
});

test('kitchen station (migrated, no PIN): opens and advances a new order', async ({ page }) => {
  const menu = await rpc<{ tables: { id: string }[]; menuItems: { id: string; name: string }[] }>('get_customer_menu', { p_restaurant_token: TOKEN });
  const soup = await pickItem();
  const order = await rpc<{ success: boolean; orderNumber: number }>('atomic_checkout', {
    p_restaurant_token: TOKEN, p_session_id: 'preview', p_table_id: menu.tables[1].id, p_payment_method: 'cash',
    p_cart: [{ menuItemId: soup.id, quantity: 1 }], p_notes: '', p_scheduled_for: '', p_client_order_id: crypto.randomUUID(),
  });
  expect(order.success).toBe(true);
  const cfg = await rpc<{ station?: { hasPin: boolean } }>('station_public_config', { p_restaurant_token: TOKEN, p_station_id: KITCHEN });
  // A PIN set by hand on the dev project cannot be typed by this suite.
  test.skip(cfg.station?.hasPin === true, 'kitchen station has a PIN on the dev project');
  await page.goto(`/station/${TOKEN}/${KITCHEN}`);
  // Desktop renders one column per status; pick the visible card of this order.
  const card = page.locator('div.rounded-2xl', { has: page.getByText(`#${order.orderNumber}`, { exact: true }) }).filter({ visible: true }).first();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^start$/i }).click();
  await expect.poll(async () => (await rpc<{ status: string }>('get_order_status', { p_restaurant_token: TOKEN, p_order_number: order.orderNumber })).status).toBe('preparing');
});

test('service station (migrated, canRecordPayments): records an in-person payment', async ({ page }) => {
  const menu = await rpc<{ tables: { id: string }[]; menuItems: { id: string; name: string }[] }>('get_customer_menu', { p_restaurant_token: TOKEN });
  const soup = await pickItem();
  const table = menu.tables[2];
  const order = await rpc<{ success: boolean; orderNumber: number }>('atomic_checkout', {
    p_restaurant_token: TOKEN, p_session_id: 'preview', p_table_id: table.id, p_payment_method: 'cash',
    p_cart: [{ menuItemId: soup.id, quantity: 1 }], p_notes: '', p_scheduled_for: '', p_client_order_id: crypto.randomUUID(),
  });
  expect(order.success).toBe(true);
  await page.goto(`/station/${TOKEN}/${SERVICE}`);
  // Service stations open on the floor map (mapAccess); the list view is the stable path.
  await page.getByRole('button', { name: /list view/i }).click();
  await page.getByRole('button', { name: `#${order.orderNumber} ` }).click();
  // The table panel lists every active order of the table; act on this order's row only.
  const row = page.locator('div.rounded-xl', { has: page.getByText(`#${order.orderNumber}`, { exact: true }) }).last();
  await row.getByRole('button', { name: /mark paid/i }).click();
  await expect.poll(async () => (await rpc<{ paymentStatus: string }>('get_order_status', { p_restaurant_token: TOKEN, p_order_number: order.orderNumber })).paymentStatus).toBe('paid');
});
