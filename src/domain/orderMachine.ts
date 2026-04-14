import type { OrderStatus } from './types';

/**
 * Valid transitions for the order state machine.
 * Terminal states (completed, refunded) have no outgoing transitions.
 *
 * paid → preparing → ready → completed
 * paid | preparing | ready → cancelled → refunded
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  paid:      ['preparing', 'cancelled'],
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
  paid:      'Paid',
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
  paid:      '#eab308',
  preparing: '#f97316',
  ready:     '#22c55e',
  completed: '#64748b',
  cancelled: '#ef4444',
  refunded:  '#8b5cf6',
};

export const ORDER_STATUS_CSS: Record<OrderStatus, string> = {
  paid:      'status-paid',
  preparing: 'status-preparing',
  ready:     'status-ready',
  completed: 'status-completed',
  cancelled: 'bg-destructive/10 text-destructive text-xs font-medium px-2 py-0.5 rounded-full',
  refunded:  'bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full',
};

/** Returns true if the order is in an "active" kitchen state. */
export function isActiveOrder(status: OrderStatus): boolean {
  return status === 'paid' || status === 'preparing' || status === 'ready';
}

/** Returns true if the order counts toward today's revenue. */
export function isRevenueOrder(status: OrderStatus): boolean {
  return status !== 'cancelled' && status !== 'refunded';
}
