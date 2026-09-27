import type { Order, OrderStatus } from './types';

/**
 * Valid transitions for the order state machine.
 * Terminal states (completed, refunded) have no outgoing transitions.
 *
 * paid → preparing → ready → completed
 * paid | preparing | ready → cancelled → refunded
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed:      ['preparing', 'cancelled'],
  preparing: ['ready',    'cancelled'],
  ready:     ['completed', 'cancelled'],
  completed: [],
  cancelled: ['refunded'],
  refunded:  [],
};

/** Returns the list of valid next statuses from a given status. */
export function nextStatuses(current: OrderStatus): OrderStatus[] {
  return TRANSITIONS[current] ?? [];
}

/** Returns true if transitioning from `from` → `to` is a valid move. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Transition check including the one actor-dependent exception: a station
 * with rework permission (actor tagged `:rework`) may send `ready` back to
 * `preparing`. Mirrors SQL `order_transition_allowed_by` (migration 017).
 */
export function canTransitionBy(from: OrderStatus, to: OrderStatus, actor = ''): boolean {
  return canTransition(from, to) || (from === 'ready' && to === 'preparing' && actor.endsWith(':rework'));
}

/**
 * Performs the status transition or throws if invalid.
 * Returns the new status so callers remain pure.
 */
export function transition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid order transition: ${from} → ${to}`);
  }
  return to;
}

/** The primary "advance" action: moves to the first valid next status. */
export function advance(current: OrderStatus): OrderStatus | null {
  const nexts = nextStatuses(current);
  // Skip 'cancelled' as the primary advance option — cancellation is explicit
  const primary = nexts.filter(s => s !== 'cancelled')[0];
  return primary ?? null;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  placed:    'New',
  preparing: 'Preparing',
  ready:     'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded:  'Refunded',
};

/**
 * Single source of truth for order status accent colors.
 * Used across kitchen, bar, and service station screens.
 */
export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  placed:      '#eab308',
  preparing: '#f97316',
  ready:     '#22c55e',
  completed: '#64748b',
  cancelled: '#ef4444',
  refunded:  '#8b5cf6',
};

export const ORDER_STATUS_CSS: Record<OrderStatus, string> = {
  placed:      'status-paid',
  preparing: 'status-preparing',
  ready:     'status-ready',
  completed: 'status-completed',
  cancelled: 'bg-destructive/10 text-destructive text-xs font-medium px-2 py-0.5 rounded-full',
  refunded:  'bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full',
};

/** Returns true if the order is in an "active" kitchen state. */
export function isActiveOrder(status: OrderStatus): boolean {
  return status === 'placed' || status === 'preparing' || status === 'ready';
}

/** Not cancelled or refunded: counts toward order volume. */
export function isLiveOrder(status: OrderStatus): boolean {
  return status !== 'cancelled' && status !== 'refunded';
}

/**
 * Realized revenue: a live order whose payment was recorded. Orders created
 * before payment tracking (paymentStatus legacy_unverified / absent) keep being
 * counted as the old system did. Unpaid orders are never revenue.
 */
export function isRevenueOrder(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  if (order.status === 'cancelled' || order.status === 'refunded') return false;
  return order.paymentStatus === 'paid' || order.paymentStatus === 'legacy_unverified' || order.paymentStatus === undefined;
}

/** Placed but not yet paid (and not cancelled): money still to collect. */
export function isOutstandingPayment(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  return order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && order.status !== 'refunded';
}
