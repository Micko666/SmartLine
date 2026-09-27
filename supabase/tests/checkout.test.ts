import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './support/db';
import { burger, checkoutArgs, createTenant, stockOf, type Tenant } from './support/fixtures';

type CheckoutResult = { success: boolean; error?: string; orderId?: string; receiptId?: string; total?: number; subtotal?: number; items?: Array<{ unitPrice: number; modifiers: unknown[] }> };

let db: TestDb;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  db = await createTestDb();
  a = await createTenant(db, 'a');
  b = await createTenant(db, 'b');
});
afterAll(async () => { await db?.close(); });

const checkout = (args: Record<string, unknown>) => db.rpc<CheckoutResult>('anon', 'atomic_checkout', args);

describe('atomic_checkout — server-authoritative input validation', () => {
  it('happy path computes price, tax and total from database values only', async () => {
    const r = await checkout(checkoutArgs(a, [burger(a, 2, [{ modifierId: 'size', optionIds: ['large'] }, { modifierId: 'extras', optionIds: ['cheese'] }])]));
    expect(r.success).toBe(true);
    expect(r.items?.[0].unitPrice).toBe(13);   // 10 + 2 (large) + 1 (cheese)
    expect(Number(r.subtotal)).toBe(26);
    expect(Number(r.total)).toBe(28.6);        // 10% exclusive tax
  });

  it.each([
    ['-1', -1], ['0', 0], ['decimal', 1.5], ['string', '2'], ['huge', 101],
  ])('rejects quantity %s without touching stock', async (_label, quantity) => {
    const before = await stockOf(db, a.saladId);
    const r = await checkout(checkoutArgs(a, [{ menuItemId: a.saladId, quantity, selectedModifiers: [] }]));
    expect(r.success).toBe(false);
    expect(await stockOf(db, a.saladId)).toBe(before);
  });

  it('rejects non-array and empty carts', async () => {
    expect((await checkout(checkoutArgs(a, {} as unknown as unknown[]))).success).toBe(false);
    expect((await checkout(checkoutArgs(a, []))).success).toBe(false);
  });

  it('rejects unknown modifier group and unknown option', async () => {
    expect((await checkout(checkoutArgs(a, [burger(a, 1, [{ modifierId: 'fake', optionIds: ['regular'] }])]))).success).toBe(false);
    expect((await checkout(checkoutArgs(a, [burger(a, 1, [{ modifierId: 'size', optionIds: ['xxl'] }])]))).success).toBe(false);
  });

  it('ignores a forged client-side modifier price', async () => {
    const forged = { modifierId: 'size', optionIds: ['large'], optionId: 'large', priceAdjustment: -100, modifierName: 'Free' };
    const r = await checkout(checkoutArgs(a, [burger(a, 1, [forged])]));
    expect(r.success).toBe(true);
    expect(r.items?.[0].unitPrice).toBe(12);
    expect(JSON.stringify(r.items?.[0].modifiers)).not.toContain('Free');
  });

  it('rejects missing required modifier and too many selections', async () => {
    expect((await checkout(checkoutArgs(a, [burger(a, 1, [])]))).success).toBe(false);
    const three = [{ modifierId: 'size', optionIds: ['regular'] }, { modifierId: 'extras', optionIds: ['cheese', 'bacon', 'onion'] }];
    expect((await checkout(checkoutArgs(a, [burger(a, 1, three)]))).success).toBe(false);
  });

  it('partial cart failure mutates no stock and creates no order', async () => {
    const t = await createTenant(db, 'partial');
    const orders = async () => (await db.sql<{ n: number }>(`SELECT count(*)::int n FROM orders WHERE user_id=$1`, [t.userId]))[0].n;
    const r = await checkout(checkoutArgs(t, [burger(t, 2), { menuItemId: t.saladId, quantity: 2, selectedModifiers: [] }]));
    expect(r.success).toBe(false);
    expect(await stockOf(db, t.burgerId)).toBe(5);
    expect(await stockOf(db, t.saladId)).toBe(1);
    expect(await orders()).toBe(0);
  });

  it('last unit: first order succeeds, second fails, stock ends at 0 (serialized)', async () => {
    const t = await createTenant(db, 'last');
    const one = { menuItemId: t.saladId, quantity: 1, selectedModifiers: [] };
    const results = await Promise.all([checkout(checkoutArgs(t, [one])), checkout(checkoutArgs(t, [one]))]);
    expect(results.filter(r => r.success)).toHaveLength(1);
    expect(await stockOf(db, t.saladId)).toBe(0);
  });

  it('rejects a menu item of tenant B through tenant A token', async () => {
    const r = await checkout(checkoutArgs(a, [{ menuItemId: b.soupId, quantity: 1, selectedModifiers: [] }]));
    expect(r.success).toBe(false);
  });

  it('rejects a table of tenant B', async () => {
    expect((await checkout(checkoutArgs(a, [{ menuItemId: a.soupId, quantity: 1 }], { p_table_id: b.tableId }))).success).toBe(false);
  });

  it('rejects disabled channels, paused ordering and invalid payment method', async () => {
    const t = await createTenant(db, 'channels', { delivery_enabled: false });
    const soup = [{ menuItemId: t.soupId, quantity: 1 }];
    const delivery = { p_table_id: 'delivery', p_customer_name: 'Ana', p_customer_phone: '+38267000000', p_delivery_address: 'Main street 1' };
    expect((await checkout(checkoutArgs(t, soup, delivery))).success).toBe(false);
    expect((await checkout(checkoutArgs(t, soup, { p_payment_method: 'bitcoin' }))).success).toBe(false);
    await db.sql(`UPDATE business_settings SET ordering_paused=true WHERE user_id=$1`, [t.userId]);
    expect((await checkout(checkoutArgs(t, soup))).success).toBe(false);
  });

  it('rejects ordering outside business hours', async () => {
    const closed = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, isOpen: false, openTime: '09:00', closeTime: '17:00' }));
    const t = await createTenant(db, 'closed', { business_hours: JSON.stringify(closed) });
    expect((await checkout(checkoutArgs(t, [{ menuItemId: t.soupId, quantity: 1 }]))).success).toBe(false);
  });

  it('validates scheduled time: dine-in, past and malformed values are rejected', async () => {
    const soup = [{ menuItemId: a.soupId, quantity: 1 }];
    const takeaway = { p_table_id: 'takeaway', p_customer_name: 'Ana', p_customer_phone: '+38267000000' };
    expect((await checkout(checkoutArgs(a, soup, { p_scheduled_for: '2099-01-01 12:00' }))).success).toBe(false);
    expect((await checkout(checkoutArgs(a, soup, { ...takeaway, p_scheduled_for: '2020-01-01 12:00' }))).success).toBe(false);
    expect((await checkout(checkoutArgs(a, soup, { ...takeaway, p_scheduled_for: 'tomorrow' }))).success).toBe(false);
  });

  it('stores structured customer fields and unpaid payment status', async () => {
    const r = await checkout(checkoutArgs(a, [{ menuItemId: a.soupId, quantity: 1 }], {
      p_table_id: 'delivery', p_customer_name: 'Ana', p_customer_phone: '+38267000000', p_delivery_address: 'Main street 1', p_notes: 'No onions',
    }));
    expect(r.success).toBe(true);
    const [o] = await db.sql<Record<string, string>>(`SELECT customer_name, customer_phone, delivery_address, order_channel, payment_status, notes FROM orders WHERE id=$1`, [r.orderId]);
    expect(o).toMatchObject({ customer_name: 'Ana', delivery_address: 'Main street 1', order_channel: 'delivery', payment_status: 'unpaid', notes: 'No onions' });
  });
});

describe('atomic_checkout — idempotency', () => {
  it('same client_order_id twice returns the original order and does not double-deduct', async () => {
    const t = await createTenant(db, 'idem');
    const args = checkoutArgs(t, [burger(t, 1)]);
    const [first, second] = await Promise.all([checkout(args), checkout(args)]);
    expect(first.success && second.success).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    expect(second.receiptId).toBe(first.receiptId);
    expect(await stockOf(db, t.burgerId)).toBe(4);
    const [{ n }] = await db.sql<{ n: number }>(`SELECT count(*)::int n FROM orders WHERE user_id=$1`, [t.userId]);
    expect(n).toBe(1);
  });

  it('requires an idempotency key', async () => {
    expect((await checkout(checkoutArgs(a, [{ menuItemId: a.soupId, quantity: 1 }], { p_client_order_id: null }))).success).toBe(false);
  });

  it('legacy 6/7-argument overloads no longer exist', async () => {
    const rows = await db.sql<{ args: string }>(`SELECT pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE proname='atomic_checkout'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].args).toContain('p_client_order_id');
  });

  it('a random uuid key from another tenant does not leak that order', async () => {
    const key = randomUUID();
    const first = await checkout(checkoutArgs(b, [{ menuItemId: b.soupId, quantity: 1 }], { p_client_order_id: key }));
    const other = await checkout(checkoutArgs(a, [{ menuItemId: a.soupId, quantity: 1 }], { p_client_order_id: key }));
    expect(other.success).toBe(true);
    expect(other.orderId).not.toBe(first.orderId);
  });
});
