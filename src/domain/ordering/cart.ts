/**
 * Checkout rules — the TypeScript mirror of the SQL `atomic_checkout`
 * (supabase/migrations/016). The server is authoritative in Supabase mode;
 * local/demo mode runs exactly these rules so both modes agree
 * (src/tests/parity.test.ts). Pure: no React, no store, no I/O.
 */
import type {
  BusinessSettings, CartItem, CartItemModifier, MenuItem, OrderChannel, OrderItem, OrderItemModifier,
  PaymentMethod, StockReservation, Table,
} from '../types';
import { isWithinHours } from './scheduling';
import { restaurantClock, wallTimeInstants } from '../time/restaurantTime';

export const MAX_CART_LINES = 50;
export const MAX_QUANTITY = 100;
export const SCHEDULE_BUFFER_MINUTES = 30;
export const SCHEDULE_HORIZON_DAYS = 90;
export const IN_PERSON_PAYMENT_METHODS: readonly PaymentMethod[] = ['cash'];
const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'card', 'google_pay', 'apple_pay'];

export interface CheckoutInput {
  cart: CartItem[];
  tableId: string;
  paymentMethod: PaymentMethod;
  scheduledFor?: string;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  notes?: string;
  sessionId: string;
}

export interface CheckoutContext {
  menuItems: MenuItem[];
  tables: Table[];
  settings: BusinessSettings;
  reservations: StockReservation[];
  now: Date;
}

export interface PricedCheckout {
  ok: true;
  channel: OrderChannel;
  tableName: string;
  items: OrderItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  estimatedPrepTime: number;
  /** Quantity to deduct per stock-tracked menu item. */
  stockDeltas: Record<string, number>;
}

export type CheckoutEvaluation = PricedCheckout | { ok: false; error: string; unavailableItems: string[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
const fail = (error: string, unavailableItems: string[] = []): CheckoutEvaluation => ({ ok: false, error, unavailableItems });

/** Wire format sent to the server: one entry per modifier group. */
export function groupModifierSelections(selected: CartItemModifier[]): { modifierId: string; optionIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const s of selected) groups.set(s.modifierId, [...(groups.get(s.modifierId) ?? []), s.optionId]);
  return [...groups].map(([modifierId, optionIds]) => ({ modifierId, optionIds }));
}

export function channelOf(tableId: string): OrderChannel {
  return tableId === 'takeaway' || tableId === 'delivery' ? tableId : 'dine-in';
}

/** Validates a requested pickup/delivery time exactly like the server. */
export function validateScheduledFor(value: string, settings: BusinessSettings, now: Date): string | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(value);
  if (!match) return 'Invalid scheduled time';
  const zone = settings.timezone || 'UTC';
  const instants = wallTimeInstants(match[1], match[2], zone);
  if (instants.length !== 1) return 'Ambiguous or nonexistent scheduled time';
  const at = instants[0];
  if (at < now.getTime() + SCHEDULE_BUFFER_MINUTES * 60_000 || at > now.getTime() + SCHEDULE_HORIZON_DAYS * 86_400_000) {
    return 'Scheduled time must be 30 minutes to 90 days ahead';
  }
  if (!isWithinHours(match[1], match[2], settings.businessHours)) return 'Restaurant is closed at the requested time';
  return null;
}

export function evaluateCheckout(input: CheckoutInput, ctx: CheckoutContext): CheckoutEvaluation {
  const { settings } = ctx;
  if (settings.orderingPaused) return fail('Ordering is currently paused');
  if (!ALL_PAYMENT_METHODS.includes(input.paymentMethod)) return fail('Invalid payment method');
  if (!Array.isArray(input.cart) || input.cart.length < 1 || input.cart.length > MAX_CART_LINES) return fail('Cart must contain 1 to 50 lines');
  if ((input.notes ?? '').length > 2000 || (input.customerName ?? '').length > 120 || (input.customerPhone ?? '').length > 40 || (input.deliveryAddress ?? '').length > 500) {
    return fail('Customer field too long');
  }

  const channel = channelOf(input.tableId);
  let tableName: string;
  if (channel === 'dine-in') {
    const table = ctx.tables.find(t => t.id === input.tableId);
    if (!table) return fail('Table not found');
    tableName = table.name;
  } else {
    if (channel === 'takeaway' && !settings.takeawayEnabled) return fail('Ordering channel is disabled');
    if (channel === 'delivery' && !settings.deliveryEnabled) return fail('Ordering channel is disabled');
    if (!(input.customerName ?? '').trim() || (input.customerPhone ?? '').trim().length < 5) return fail('Name and phone are required');
    if (channel === 'delivery' && (input.deliveryAddress ?? '').trim().length < 5) return fail('Delivery address is required');
    tableName = channel === 'takeaway' ? 'Takeaway' : 'Delivery';
  }

  if (input.scheduledFor) {
    if (channel === 'dine-in') return fail('Invalid scheduled time');
    const error = validateScheduledFor(input.scheduledFor, settings, ctx.now);
    if (error) return fail(error);
  } else {
    const local = restaurantClock(settings.timezone || 'UTC', ctx.now);
    if (!isWithinHours(local.date, local.time, settings.businessHours)) return fail('Restaurant is closed at the requested time');
  }

  // PASS 1 — validate and price every line from menu data; no mutation.
  const needed: Record<string, number> = {};
  for (const line of input.cart) {
    const q = line.quantity as unknown;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) return fail('Quantity must be a positive integer');
    if (q > MAX_QUANTITY) return fail('Quantity exceeds 100');
    needed[line.menuItemId] = (needed[line.menuItemId] ?? 0) + q;
  }

  const items: OrderItem[] = [];
  let subtotal = 0;
  let maxPrep = 0;
  for (const line of input.cart) {
    const item = ctx.menuItems.find(m => m.id === line.menuItemId);
    if (!item || item.status !== 'active') return fail('Item is unavailable', [item?.name ?? line.menuItemId]);
    if (needed[item.id] > MAX_QUANTITY) return fail('Total item quantity exceeds 100');
    if (item.stock !== null) {
      const reserved = ctx.reservations
        .filter(r => r.sessionId !== input.sessionId && r.expiresAt > ctx.now.getTime())
        .flatMap(r => r.items).filter(ri => ri.menuItemId === item.id)
        .reduce((sum, ri) => sum + ri.quantity, 0);
      if (item.stock - reserved < needed[item.id]) return fail(`Insufficient stock for ${item.name}`, [item.name]);
    }

    const selected = line.selectedModifiers ?? [];
    const seen = new Set<string>();
    const resolved: OrderItemModifier[] = [];
    let price = item.price;
    for (const sel of selected) {
      const key = `${sel.modifierId}:${sel.optionId}`;
      if (seen.has(key)) return fail('Duplicate modifier selection');
      seen.add(key);
      const group = item.modifiers.find(m => m.id === sel.modifierId);
      if (!group) return fail('Unknown modifier');
      const option = group.options.find(o => o.id === sel.optionId);
      if (!option) return fail('Unknown modifier option');
      price += option.priceAdjustment ?? 0;
      resolved.push({ modifierId: group.id, modifierName: group.name, optionId: option.id, optionName: option.name, priceAdjustment: option.priceAdjustment ?? 0 });
    }
    for (const group of item.modifiers) {
      const count = selected.filter(s => s.modifierId === group.id).length;
      if (group.required && count === 0) return fail('Required modifier missing');
      if (count > (group.maxSelections ?? 1)) return fail('Too many modifier selections');
    }
    if (price < 0) return fail('Invalid configured item price');
    price = round2(price);
    const quantity = line.quantity as number;
    subtotal += price * quantity;
    maxPrep = Math.max(maxPrep, item.prepTime ?? 0);
    items.push({ menuItemId: item.id, menuItemName: item.name, menuItemIcon: item.icon, quantity, unitPrice: price, modifiers: resolved, lineTotal: round2(price * quantity) });
  }

  subtotal = round2(subtotal);
  const taxAmount = settings.taxDisplay === 'exclusive' ? round2(subtotal * (settings.taxRate ?? 0) / 100) : 0;
  const stockDeltas: Record<string, number> = {};
  for (const [id, qty] of Object.entries(needed)) {
    if (ctx.menuItems.find(m => m.id === id)?.stock !== null) stockDeltas[id] = qty;
  }
  return {
    ok: true, channel, tableName, items, subtotal, taxAmount, total: round2(subtotal + taxAmount),
    estimatedPrepTime: maxPrep + Math.max(0, items.length - 1) * 2, stockDeltas,
  };
}
