/**
 * Order status operations — TypeScript mirror of SQL
 * `transition_order_internal` (migration 017). Used by local/demo mode;
 * Supabase mode calls the RPC. Pure function over the three affected slices.
 */
import type { MenuItem, Order, OrderStatus, Table } from '../types';
import { canTransitionBy, isActiveOrder } from '../orderMachine';

export interface OrderSlices { orders: Order[]; menuItems: MenuItem[]; tables: Table[] }

export type TransitionResult =
  | ({ ok: true; order: Order } & OrderSlices)
  | { ok: false; error: string };

export function applyTransition(
  state: OrderSlices,
  orderId: string,
  expected: OrderStatus,
  next: OrderStatus,
  actor: string,
  now = new Date().toISOString(),
): TransitionResult {
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return { ok: false, error: 'Order not found' };
  // Cancelling an already-cancelled order is an idempotent no-op (no second restock).
  if (order.status === 'cancelled' && next === 'cancelled') return { ok: true, order, ...state };
  if (order.status !== expected) return { ok: false, error: 'Order changed; refresh and try again' };
  if (!canTransitionBy(order.status, next, actor)) return { ok: false, error: 'Invalid order transition' };

  let menuItems = state.menuItems;
  let stockRestoredAt = order.stockRestoredAt;
  if (next === 'cancelled' && !stockRestoredAt) {
    menuItems = menuItems.map(m => {
      const qty = order.items.filter(i => i.menuItemId === m.id).reduce((s, i) => s + i.quantity, 0);
      if (qty === 0) return m;
      return {
        ...m,
        stock: m.stock === null ? null : m.stock + qty,
        salesCount: Math.max(0, m.salesCount - qty),
        updatedAt: now,
      };
    });
    stockRestoredAt = now;
  }

  // A refund reverses a recorded payment; unpaid/legacy payment states stay as they are.
  const paymentStatus = next === 'refunded' && order.paymentStatus === 'paid' ? 'refunded' : order.paymentStatus;
  const updated: Order = { ...order, status: next, paymentStatus, stockRestoredAt, updatedAt: now };
  const orders = state.orders.map(o => (o.id === orderId ? updated : o));

  let tables = state.tables;
  if ((next === 'cancelled' || next === 'completed' || next === 'refunded')
      && !orders.some(o => o.tableId === order.tableId && isActiveOrder(o.status))) {
    tables = tables.map(t => (t.id === order.tableId && t.status === 'occupied' ? { ...t, status: 'available' } : t));
  }
  return { ok: true, order: updated, orders, menuItems, tables };
}

export type PaymentResult =
  | { ok: true; order: Order; orders: Order[] }
  | { ok: false; error: string };

/**
 * Mirror of SQL `record_payment_internal` (migration 024): marks a live unpaid
 * order as paid. Idempotent; never touches the fulfillment status.
 */
export function applyRecordPayment(orders: Order[], orderId: string, now = new Date().toISOString()): PaymentResult {
  const order = orders.find(o => o.id === orderId);
  if (!order) return { ok: false, error: 'Order not found' };
  if (order.paymentStatus === 'paid') return { ok: true, order, orders };
  if (order.status === 'cancelled' || order.status === 'refunded') return { ok: false, error: 'Order is cancelled' };
  if (order.paymentStatus !== 'unpaid') return { ok: false, error: `Payment state ${order.paymentStatus ?? 'unknown'} cannot be recorded` };
  const updated: Order = { ...order, paymentStatus: 'paid', paidAt: now, updatedAt: now };
  return { ok: true, order: updated, orders: orders.map(o => (o.id === orderId ? updated : o)) };
}
