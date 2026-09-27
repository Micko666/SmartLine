import type { Order } from '../types';

/**
 * Merges authoritative server rows into the local order list by id.
 * Rows not in `updates` are kept unchanged; new ids are prepended.
 * (The previous visibility refresh replaced every active order with the
 * fetched active set, which dropped orders that finished while the tab was
 * hidden.)
 */
export function mergeOrders(current: Order[], updates: Order[]): Order[] {
  if (updates.length === 0) return current;
  const byId = new Map(updates.map(o => [o.id, o]));
  const merged = current.map(o => byId.get(o.id) ?? o);
  const known = new Set(current.map(o => o.id));
  const added = updates.filter(o => !known.has(o.id));
  return [...added, ...merged].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
