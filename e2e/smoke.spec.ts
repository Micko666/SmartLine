/**
 * Critical-path smoke tests (local/demo mode — the dev server runs without
 * Supabase env vars, see playwright.config.ts). The clock is fixed to a
 * Monday at noon in the demo restaurant's timezone so business hours are open.
 */
import { expect, test, type Page } from '@playwright/test';

const MONDAY_NOON = new Date('2026-09-28T10:00:00Z');
const ITEM = 'Classic Margherita';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(MONDAY_NOON);
});

/** Local mode keeps the restaurant in this browser, so the owner signs in first. */
async function loginDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

async function addItemAndOpenPayment(page: Page) {
  await page.getByText(ITEM).first().click();
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.getByRole('button', { name: /view cart/i }).click();
  await page.getByRole('button', { name: /proceed to payment/i }).click();
}

test('admin login shows the dashboard shell', async ({ page }) => {
  await loginDemo(page);
  await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('dine-in QR order lands on the receipt', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/menu?t=tbl-1&r=demo');
  await addItemAndOpenPayment(page);
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\//);
  await expect(page.getByRole('link', { name: /order more/i })).toHaveAttribute('href', '/menu?t=tbl-1&r=demo');
});

test('takeaway order through the portal schedule step', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/order/demo');
  await page.getByRole('button', { name: /takeaway/i }).click();
  await expect(page.getByText('Showing times at least 30 min from now')).toBeVisible();
  await page.getByRole('button', { name: /browse menu/i }).click();
  await expect(page).toHaveURL(/mode=takeaway/);
  await addItemAndOpenPayment(page);
  await page.getByPlaceholder('Full name *').fill('Ana');
  await page.getByPlaceholder('Phone number *').fill('+382 67 123 456');
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\/.*mode=takeaway/);
});

test('delivery order: address never appears in the URL', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/settings');
  const delivery = page.getByRole('switch', { name: 'Delivery' });
  if ((await delivery.getAttribute('aria-checked')) !== 'true') await delivery.click();
  await expect(delivery).toHaveAttribute('aria-checked', 'true');

  await page.goto('/order/demo');
  await page.getByRole('button', { name: /delivery/i }).click();
  await page.getByPlaceholder('Street, city, postcode').fill('Njegoševa 1, Podgorica');
  await page.getByRole('button', { name: /browse menu/i }).click();
  await expect(page).toHaveURL(/mode=delivery/);
  expect(page.url()).not.toContain('Njego');
  await addItemAndOpenPayment(page);
  await page.getByPlaceholder('Full name *').fill('Ana');
  await page.getByPlaceholder('Phone number *').fill('+382 67 123 456');
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\/.*mode=delivery/);
  expect(page.url()).not.toContain('Njego');
});

test('admin advances a new order', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/menu?t=tbl-1&r=demo');
  await addItemAndOpenPayment(page);
  await page.getByRole('button', { name: /place order/i }).click();
  await expect(page).toHaveURL(/\/receipt\//);

  await page.goto('/orders');
  // Exact name: the status filter tabs are named e.g. "Preparing 0".
  await page.getByRole('button', { name: 'Preparing', exact: true }).first().click();
  await expect(page.getByText(/→ Preparing/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ready', exact: true }).first()).toBeVisible();
});

test('booking happy path returns a confirmation code', async ({ page }) => {
  await loginDemo(page);
  await page.goto('/book/demo');
  await page.locator('button[data-date="2026-09-30"]').click();   // Wednesday, open 09-22
  await page.getByRole('button', { name: '19:00' }).click();
  await page.getByLabel(/Full name/).fill('Ana');
  await page.getByLabel(/Phone/).fill('+382 67 123 456');
  await page.getByRole('button', { name: /send event request/i }).click();
  await expect(page.getByTestId('confirmation-code')).toHaveText(/^[0-9A-F]{8}$/);
});
