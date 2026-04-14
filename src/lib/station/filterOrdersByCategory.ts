import type { Order, OrderItem, MenuItem, CategoryMode } from '@/domain/types';

/**
 * Unified result type for category-filtered orders.
 * `items`   — primary items to display at full opacity.
 * `context` — secondary items shown dimmed (focus mode only; empty otherwise).
 */
export interface DisplayOrder {
  order: Order;
  items: OrderItem[];
  context: OrderItem[];
}

/**
 * Single entry point for all station category filtering.
 *
 * mode === 'all' or categories is empty → all orders, all items, no dimming
 * mode === 'exclusive' → only orders containing at least one matching item;
 *   those orders show only the matching items (context is empty)
 * mode === 'focus' → only orders containing at least one matching item;
 *   matching items are primary, others surfaced dimmed as context
 *
 * In every case the returned shape is consistent: { order, items, context }.
 */
export function applyStationFilter(
  orders: Order[],
  menuItems: MenuItem[],
  categories: string[],
  mode: CategoryMode,
): DisplayOrder[] {
  if (categories.length === 0 || mode === 'all') {
    return orders.map(o => ({ order: o, items: o.items, context: [] }));
  }

  const catByItemId = new Map<string, string>(menuItems.map(m => [m.id, m.category]));
  const isMatch = (item: OrderItem) => categories.includes(catByItemId.get(item.menuItemId) ?? '');

  return orders.map(o => {
    const matched   = o.items.filter(isMatch);
    const unmatched = o.items.filter(i => !isMatch(i));

    if (mode === 'exclusive') {
      // Exclusive: hide orders with no matching items entirely.
      return matched.length > 0
        ? { order: o, items: matched, context: [] }
        : null;
    }

    // Focus: show every order. Matching items are primary; the rest are dimmed.
    // Orders with zero matching items show everything dimmed (pure context).
    return {
      order:   o,
      items:   matched,
      context: unmatched,
    };
  }).filter(Boolean) as DisplayOrder[];
}
