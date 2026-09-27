/**
 * Local/Supabase parity: the same scenario is evaluated by the TypeScript
 * domain rules used in local/demo mode and by the SQL used in Supabase mode.
 * Both must agree on accept/reject and on money/stock outcomes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './support/db';
import { ALWAYS_OPEN, BURGER_MODIFIERS, checkoutArgs, createTenant, type Tenant } from './support/fixtures';
import { evaluateCheckout, groupModifierSelections, type CheckoutInput } from '@/domain/ordering/cart';
import { applyTransition } from '@/domain/ordering/orderOperations';
import { DEFAULT_SETTINGS } from '@/domain/initialData';
import type { BusinessSettings, CartItem, MenuItem, Order, OrderStatus, Table } from '@/domain/types';

let db: TestDb;

function menuFor(t: Tenant): MenuItem[] {
  const base = { description: '', category: 'Food', prepTime: 10, maxStock: null, status: 'active' as const, icon: '', imageUrl: '', thumbnailUrl: '', tags: [], sortOrder: 0, salesCount: 0, createdAt: '', updatedAt: '' };
  return [
    { ...base, id: t.burgerId, name: 'Burger', price: 10, stock: 5, modifiers: BURGER_MODIFIERS },
    { ...base, id: t.saladId, name: 'Salad', price: 8, stock: 1, modifiers: [] },
    { ...base, id: t.soupId, name: 'Soup', price: 5, stock: null, modifiers: [] },
  ];
}

function settingsFor(t: Tenant, overrides: Partial<BusinessSettings> = {}): BusinessSettings {
  return { ...DEFAULT_SETTINGS, restaurantToken: t.token, timezone: 'Europe/Podgorica', taxRate: 10, taxDisplay: 'exclusive',
    takeawayEnabled: true, deliveryEnabled: true, businessHours: ALWAYS_OPEN as BusinessSettings['businessHours'], ...overrides };
}

type Scenario = { name: string; cart: CartItem[]; extra?: Partial<CheckoutInput>; settings?: Partial<BusinessSettings>; sql?: Record<string, unknown> };

const scenarios = (t: Tenant): Scenario[] => {
  const regular = [{ modifierId: 'size', optionId: 'regular' }];
  return [
    { name: 'valid with modifiers', cart: [{ menuItemId: t.burgerId, quantity: 2, selectedModifiers: [{ modifierId: 'size', optionId: 'large' }, { modifierId: 'extras', optionId: 'cheese' }] }] },
    { name: 'negative quantity', cart: [{ menuItemId: t.soupId, quantity: -1, selectedModifiers: [] }] },
    { name: 'zero quantity', cart: [{ menuItemId: t.soupId, quantity: 0, selectedModifiers: [] }] },
    { name: 'decimal quantity', cart: [{ menuItemId: t.soupId, quantity: 1.5, selectedModifiers: [] }] },
    { name: 'fake modifier', cart: [{ menuItemId: t.burgerId, quantity: 1, selectedModifiers: [{ modifierId: 'nope', optionId: 'regular' }] }] },
    { name: 'fake option', cart: [{ menuItemId: t.burgerId, quantity: 1, selectedModifiers: [{ modifierId: 'size', optionId: 'xxl' }] }] },
    { name: 'missing required', cart: [{ menuItemId: t.burgerId, quantity: 1, selectedModifiers: [] }] },
    { name: 'too many selections', cart: [{ menuItemId: t.burgerId, quantity: 1, selectedModifiers: [...regular, { modifierId: 'extras', optionId: 'cheese' }, { modifierId: 'extras', optionId: 'bacon' }, { modifierId: 'extras', optionId: 'onion' }] }] },
    { name: 'partial stock', cart: [{ menuItemId: t.burgerId, quantity: 1, selectedModifiers: regular }, { menuItemId: t.saladId, quantity: 2, selectedModifiers: [] }] },
    { name: 'foreign item', cart: [{ menuItemId: randomUUID(), quantity: 1, selectedModifiers: [] }] },
    { name: 'disabled delivery', cart: [{ menuItemId: t.soupId, quantity: 1, selectedModifiers: [] }], settings: { deliveryEnabled: false }, sql: { delivery_enabled: false },
      extra: { tableId: 'delivery', customerName: 'Ana', customerPhone: '+38267000000', deliveryAddress: 'Main street 1' } },
    { name: 'paused', cart: [{ menuItemId: t.soupId, quantity: 1, selectedModifiers: [] }], settings: { orderingPaused: true }, sql: { ordering_paused: true } },
    { name: 'delivery missing address', cart: [{ menuItemId: t.soupId, quantity: 1, selectedModifiers: [] }], extra: { tableId: 'delivery', customerName: 'Ana', customerPhone: '+38267000000' } },
    { name: 'scheduled dine-in', cart: [{ menuItemId: t.soupId, quantity: 1, selectedModifiers: [] }], extra: { scheduledFor: '2099-01-01 12:00' } },
  ];
};

beforeAll(async () => { db = await createTestDb(); });
afterAll(async () => { await db?.close(); });

describe('checkout parity (TypeScript domain vs SQL atomic_checkout)', () => {
  it('agrees on every scenario: accept/reject, totals and stock deltas', async () => {
    const probe = await createTenant(db, 'probe');
    for (const scenario of scenarios(probe)) {
      const t = await createTenant(db, 'parity', scenario.sql ?? {});
      const sc = scenarios(t).find(x => x.name === scenario.name)!;
      const input: CheckoutInput = { cart: sc.cart, tableId: t.tableId, paymentMethod: 'cash', sessionId: 's', ...sc.extra };
      const table: Table = { id: t.tableId, number: 1, name: 'Table 1', capacity: 4, status: 'available', shape: 'square', createdAt: '' };
      const local = evaluateCheckout(input, { menuItems: menuFor(t), tables: [table], settings: settingsFor(t, sc.settings), reservations: [], now: new Date() });

      const sqlCart = sc.cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity, selectedModifiers: groupModifierSelections(c.selectedModifiers) }));
      const remote = await db.rpc<{ success: boolean; total?: number; error?: string }>('anon', 'atomic_checkout', checkoutArgs(t, sqlCart, {
        p_table_id: input.tableId, p_scheduled_for: input.scheduledFor ?? '',
        p_customer_name: input.customerName ?? '', p_customer_phone: input.customerPhone ?? '', p_delivery_address: input.deliveryAddress ?? '',
      }));

      expect(remote.success, `${sc.name}: ${remote.error ?? ''} / ${local.ok ? '' : local.error}`).toBe(local.ok);
      if (local.ok && remote.success) {
        expect(Number(remote.total), sc.name).toBe(local.total);
        for (const [id, qty] of Object.entries(local.stockDeltas)) {
          const [row] = await db.sql<{ stock: number }>(`SELECT stock FROM menu_items WHERE id=$1`, [id]);
          const before = menuFor(t).find(m => m.id === id)!.stock!;
          expect(row.stock, sc.name).toBe(before - qty);
        }
      }
    }
  });
});

describe('order operation parity (TypeScript applyTransition vs SQL transition_order_internal)', () => {
  const cases: Array<{ path: Array<[OrderStatus, OrderStatus]>; actor?: string }> = [
    { path: [['paid', 'preparing'], ['preparing', 'ready'], ['ready', 'completed']] },
    { path: [['paid', 'ready']] },
    { path: [['paid', 'cancelled'], ['cancelled', 'cancelled'], ['cancelled', 'refunded']] },
    { path: [['paid', 'preparing'], ['preparing', 'ready'], ['ready', 'preparing']] },
    { path: [['paid', 'preparing'], ['preparing', 'ready'], ['ready', 'preparing']], actor: 'station:x:rework' },
    { path: [['paid', 'preparing'], ['paid', 'preparing']] },
    { path: [['paid', 'preparing'], ['preparing', 'ready'], ['ready', 'completed'], ['completed', 'cancelled']] },
  ];

  it.each(cases.map((c, i) => [i, c] as const))('case %i: same accept/reject, stock and table outcome', async (_i, c) => {
    const t = await createTenant(db, 'ops');
    const r = await db.rpc<{ success: boolean; orderId: string; items: Order['items'] }>('anon', 'atomic_checkout',
      checkoutArgs(t, [{ menuItemId: t.burgerId, quantity: 2, selectedModifiers: [{ modifierId: 'size', optionIds: ['regular'] }] }]));
    let local = {
      orders: [{ id: r.orderId, orderNumber: 1, tableId: t.tableId, tableName: 'Table 1', items: r.items, status: 'paid', subtotal: 0, taxRate: 0, taxAmount: 0, total: 0, paymentMethod: 'cash', notes: '', estimatedPrepTime: 0, prepTimeAdjustment: 0, createdAt: '', paidAt: '', updatedAt: '' } as Order],
      menuItems: menuFor(t).map(m => m.id === t.burgerId ? { ...m, stock: 3 } : m),
      tables: [{ id: t.tableId, number: 1, name: 'Table 1', capacity: 4, status: 'occupied', shape: 'square', createdAt: '' } as Table],
    };
    for (const [expected, next] of c.path) {
      const actor = c.actor ?? 'owner';
      const remote = await db.sql<{ r: { ok: boolean } }>(`SELECT (SELECT transition_order_internal($1,$2,$3,$4,$5)) AS r`, [t.userId, r.orderId, expected, next, actor])
        .then(rows => rows[0].r.ok).catch(() => false);
      const result = applyTransition(local, r.orderId, expected, next, actor);
      expect(remote, `${expected}->${next}`).toBe(result.ok);
      if (result.ok) local = { orders: result.orders, menuItems: result.menuItems, tables: result.tables };
    }
    const [stock] = await db.sql<{ stock: number }>(`SELECT stock FROM menu_items WHERE id=$1`, [t.burgerId]);
    const [table] = await db.sql<{ status: string }>(`SELECT status FROM tables WHERE id=$1`, [t.tableId]);
    const [order] = await db.sql<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [r.orderId]);
    expect(stock.stock).toBe(local.menuItems.find(m => m.id === t.burgerId)!.stock);
    expect(table.status).toBe(local.tables[0].status);
    expect(order.status).toBe(local.orders[0].status);
  });
});
