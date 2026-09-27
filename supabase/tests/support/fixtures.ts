import { randomUUID } from 'node:crypto';
import type { TestDb } from './db';

export interface Tenant {
  userId: string;
  token: string;
  tableId: string;
  burgerId: string;   // stock 5, required "Size" modifier (+2 for large), optional extras (max 2)
  saladId: string;    // stock 1
  soupId: string;     // unlimited stock
}

export const ALWAYS_OPEN = [0, 1, 2, 3, 4, 5, 6].map(dayOfWeek => ({ dayOfWeek, isOpen: true, openTime: '00:00', closeTime: '00:00' }));

export const BURGER_MODIFIERS = [
  { id: 'size', name: 'Size', required: true, maxSelections: 1, options: [
    { id: 'regular', name: 'Regular', priceAdjustment: 0 },
    { id: 'large', name: 'Large', priceAdjustment: 2 },
  ] },
  { id: 'extras', name: 'Extras', required: false, maxSelections: 2, options: [
    { id: 'cheese', name: 'Cheese', priceAdjustment: 1 },
    { id: 'bacon', name: 'Bacon', priceAdjustment: 1.5 },
    { id: 'onion', name: 'Onion', priceAdjustment: 0.5 },
  ] },
];

/** Creates an owner (auth user + settings row) with a small menu and one table. */
export async function createTenant(db: Pick<TestDb, 'sql'>, name: string, overrides: Record<string, unknown> = {}): Promise<Tenant> {
  const userId = randomUUID();
  const token = `tok-${name}-${randomUUID()}`;
  await db.sql(`INSERT INTO auth.users(id, email) VALUES ($1, $2)`, [userId, `${name}@example.test`]);
  const settings = {
    business_name: `Restaurant ${name}`, restaurant_token: token, timezone: 'Europe/Podgorica',
    tax_rate: 10, tax_display: 'exclusive', takeaway_enabled: true, delivery_enabled: true,
    business_hours: JSON.stringify(ALWAYS_OPEN), ...overrides,
  };
  const cols = Object.keys(settings);
  await db.sql(
    `INSERT INTO business_settings(user_id, ${cols.join(',')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(',')})`,
    [userId, ...cols.map(c => (settings as Record<string, unknown>)[c])],
  );
  const [table] = await db.sql<{ id: string }>(`INSERT INTO tables(user_id, number, name) VALUES ($1, 1, 'Table 1') RETURNING id`, [userId]);
  const item = async (itemName: string, price: number, stock: number | null, modifiers: unknown[] = []) =>
    (await db.sql<{ id: string }>(
      `INSERT INTO menu_items(user_id, name, price, stock, modifiers, prep_time) VALUES ($1,$2,$3,$4,$5,10) RETURNING id`,
      [userId, itemName, price, stock, JSON.stringify(modifiers)],
    ))[0].id;
  return {
    userId, token, tableId: table.id,
    burgerId: await item('Burger', 10, 5, BURGER_MODIFIERS),
    saladId: await item('Salad', 8, 1),
    soupId: await item('Soup', 5, null),
  };
}

export function checkoutArgs(t: Tenant, cart: unknown[], extra: Record<string, unknown> = {}) {
  return {
    p_restaurant_token: t.token, p_session_id: 's-' + randomUUID(), p_table_id: t.tableId,
    p_payment_method: 'cash', p_cart: cart, p_notes: '', p_scheduled_for: '',
    p_client_order_id: randomUUID(), ...extra,
  };
}

export async function stockOf(db: Pick<TestDb, 'sql'>, itemId: string): Promise<number | null> {
  const [row] = await db.sql<{ stock: number | null }>(`SELECT stock FROM menu_items WHERE id=$1`, [itemId]);
  return row.stock;
}

export const burger = (t: Tenant, quantity = 1, selectedModifiers: unknown[] = [{ modifierId: 'size', optionIds: ['regular'] }]) =>
  ({ menuItemId: t.burgerId, quantity, selectedModifiers });
