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
import type { BusinessSettings, CalendarEventStatus, CalendarEventType, CartItem, MenuItem, Order, OrderStatus, Table } from '@/domain/types';

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
    { path: [['placed', 'preparing'], ['preparing', 'ready'], ['ready', 'completed']] },
    { path: [['placed', 'ready']] },
    { path: [['placed', 'cancelled'], ['cancelled', 'cancelled'], ['cancelled', 'refunded']] },
    { path: [['placed', 'preparing'], ['preparing', 'ready'], ['ready', 'preparing']] },
    { path: [['placed', 'preparing'], ['preparing', 'ready'], ['ready', 'preparing']], actor: 'station:x:rework' },
    { path: [['placed', 'preparing'], ['placed', 'preparing']] },
    { path: [['placed', 'preparing'], ['preparing', 'ready'], ['ready', 'completed'], ['completed', 'cancelled']] },
  ];

  it.each(cases.map((c, i) => [i, c] as const))('case %i: same accept/reject, stock and table outcome', async (_i, c) => {
    const t = await createTenant(db, 'ops');
    const r = await db.rpc<{ success: boolean; orderId: string; items: Order['items'] }>('anon', 'atomic_checkout',
      checkoutArgs(t, [{ menuItemId: t.burgerId, quantity: 2, selectedModifiers: [{ modifierId: 'size', optionIds: ['regular'] }] }]));
    let local = {
      orders: [{ id: r.orderId, orderNumber: 1, tableId: t.tableId, tableName: 'Table 1', items: r.items, status: 'placed', subtotal: 0, taxRate: 0, taxAmount: 0, total: 0, paymentMethod: 'cash', notes: '', estimatedPrepTime: 0, prepTimeAdjustment: 0, createdAt: '', updatedAt: '' } as Order],
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

import { decideBooking } from '@/domain/booking/policy';

describe('booking parity (TypeScript decideBooking vs SQL submit_booking)', () => {
  const day = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Podgorica' }).format(new Date(Date.now() + n * 86_400_000));
  const weekdayAhead = (dow: number) => { for (let i = 2; i < 10; i++) { const d = day(i); if (new Date(`${d}T12:00:00Z`).getUTCDay() === dow) return d; } return day(2); };

  it('agrees on accept/reject and status for a matrix of requests', async () => {
    const settings = { maxEventsPerDay: 1, requireApproval: false, advanceBookingDays: 30 };
    const t = await createTenant(db, 'bookparity', { calendar_settings: JSON.stringify(settings) });
    const [{ id: pkgId }] = await db.sql<{ id: string }>(`INSERT INTO event_packages(user_id, name, min_guests, max_guests) VALUES ($1,'Party',10,20) RETURNING id`, [t.userId]);
    const packages = [{ id: pkgId, name: 'Party', emoji: '', description: '', minGuests: 10, maxGuests: 20, duration: 2, details: '', active: true, createdAt: '' }];
    const base = { date: weekdayAhead(3), timeSlot: '19:00', type: 'reservation', customerName: 'Guest', customerPhone: '+38267123456', customerEmail: '', guestCount: 2, packageId: null as string | null, notes: '' };
    const requests = [
      base,
      { ...base, type: 'closure' },
      { ...base, date: '2020-01-01' },
      { ...base, date: day(45) },
      { ...base, date: weekdayAhead(0) },
      { ...base, timeSlot: '21:30' },
      { ...base, timeSlot: '19:15' },
      { ...base, guestCount: 0 },
      { ...base, customerPhone: '12' },
      { ...base, date: weekdayAhead(4), type: 'private_event', packageId: pkgId, guestCount: 5 },
      { ...base, date: weekdayAhead(4), type: 'private_event', packageId: pkgId, guestCount: 12 },
      { ...base },                                   // second on the same day -> max/day
    ];
    const events: Array<{ date: string; timeSlot: string; type: CalendarEventType; status: CalendarEventStatus }> = [];
    for (const req of requests) {
      const local = decideBooking(req, { settings, timezone: 'Europe/Podgorica', packages, events });
      const remote = await db.rpc<{ ok: boolean; status?: string; error?: string }>('anon', 'submit_booking', {
        p_restaurant_token: t.token, p_client_request_id: randomUUID(), p_date: req.date, p_time_slot: req.timeSlot, p_type: req.type,
        p_customer_name: req.customerName, p_customer_phone: req.customerPhone, p_customer_email: req.customerEmail,
        p_guest_count: req.guestCount, p_package_id: req.packageId, p_notes: req.notes,
      });
      expect(remote.ok, `${JSON.stringify(req)} remote=${remote.error} local=${local.ok ? '' : local.error}`).toBe(local.ok);
      if (local.ok && remote.ok) {
        expect(remote.status).toBe(local.status);
        events.push({ date: req.date, timeSlot: req.timeSlot, type: req.type as CalendarEventType, status: local.status });
      }
    }
  });
});
