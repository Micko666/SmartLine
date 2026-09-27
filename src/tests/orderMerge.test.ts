import { describe, expect, it } from 'vitest';
import { mergeOrders } from '@/domain/ordering/orderMerge';
import type { Order } from '@/domain/types';

const order = (id: string, status: Order['status'], createdAt: string): Order => ({
  id, orderNumber: 1, tableId: 't', tableName: 'T', items: [], status, subtotal: 0, taxRate: 0, taxAmount: 0, total: 0,
  paymentMethod: 'cash', notes: '', estimatedPrepTime: 0, prepTimeAdjustment: 0, createdAt, paidAt: createdAt, updatedAt: createdAt,
});

describe('mergeOrders (admin visibility refresh)', () => {
  it('updates an order that completed while the tab was hidden instead of dropping it', () => {
    const current = [order('a', 'ready', '2026-01-02'), order('b', 'completed', '2026-01-01')];
    const merged = mergeOrders(current, [order('a', 'completed', '2026-01-02')]);
    expect(merged.map(o => [o.id, o.status])).toEqual([['a', 'completed'], ['b', 'completed']]);
  });

  it('adds new orders and keeps untouched history, newest first', () => {
    const merged = mergeOrders([order('b', 'completed', '2026-01-01')], [order('c', 'placed', '2026-01-03')]);
    expect(merged.map(o => o.id)).toEqual(['c', 'b']);
  });

  it('is a no-op for an empty update', () => {
    const current = [order('a', 'placed', '2026-01-01')];
    expect(mergeOrders(current, [])).toBe(current);
  });
});
