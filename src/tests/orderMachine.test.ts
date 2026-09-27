import { describe, it, expect } from 'vitest';
import {
  canTransition, transition, advance, nextStatuses,
  isActiveOrder, isLiveOrder, isRevenueOrder,
  isOutstandingPayment, ORDER_STATUS_LABELS,
} from '../domain/orderMachine';
import type { OrderStatus } from '../domain/types';

describe('orderMachine', () => {
  // ── canTransition ──────────────────────────────────────────────
  describe('canTransition', () => {
    it('allows placed → preparing', () => {
      expect(canTransition('placed', 'preparing')).toBe(true);
    });
    it('allows placed → cancelled', () => {
      expect(canTransition('placed', 'cancelled')).toBe(true);
    });
    it('allows preparing → ready', () => {
      expect(canTransition('preparing', 'ready')).toBe(true);
    });
    it('allows ready → completed', () => {
      expect(canTransition('ready', 'completed')).toBe(true);
    });
    it('allows cancelled → refunded', () => {
      expect(canTransition('cancelled', 'refunded')).toBe(true);
    });
    it('blocks placed → completed (skip steps)', () => {
      expect(canTransition('placed', 'completed')).toBe(false);
    });
    it('blocks completed → preparing (backwards)', () => {
      expect(canTransition('completed', 'preparing')).toBe(false);
    });
    it('blocks refunded → anything (terminal)', () => {
      const allStatuses: OrderStatus[] = ['placed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];
      allStatuses.forEach(s => {
        expect(canTransition('refunded', s)).toBe(false);
      });
    });
    it('blocks completed → anything (terminal)', () => {
      const allStatuses: OrderStatus[] = ['placed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];
      allStatuses.forEach(s => {
        expect(canTransition('completed', s)).toBe(false);
      });
    });
  });

  // ── transition ─────────────────────────────────────────────────
  describe('transition', () => {
    it('returns new status on valid transition', () => {
      expect(transition('placed', 'preparing')).toBe('preparing');
    });
    it('throws on invalid transition', () => {
      expect(() => transition('placed', 'completed')).toThrow();
    });
    it('throws on backwards transition', () => {
      expect(() => transition('ready', 'placed')).toThrow();
    });
  });

  // ── advance ────────────────────────────────────────────────────
  describe('advance', () => {
    it('advances placed → preparing (skips cancelled as primary)', () => {
      expect(advance('placed')).toBe('preparing');
    });
    it('advances preparing → ready', () => {
      expect(advance('preparing')).toBe('ready');
    });
    it('advances ready → completed', () => {
      expect(advance('ready')).toBe('completed');
    });
    it('returns null for terminal completed', () => {
      expect(advance('completed')).toBeNull();
    });
    it('returns null for terminal refunded', () => {
      expect(advance('refunded')).toBeNull();
    });
    it('advances cancelled → refunded', () => {
      expect(advance('cancelled')).toBe('refunded');
    });
  });

  // ── nextStatuses ───────────────────────────────────────────────
  describe('nextStatuses', () => {
    it('returns all valid next statuses for placed', () => {
      const nexts = nextStatuses('placed');
      expect(nexts).toContain('preparing');
      expect(nexts).toContain('cancelled');
    });
    it('returns empty array for completed', () => {
      expect(nextStatuses('completed')).toHaveLength(0);
    });
  });

  // ── helper flags ───────────────────────────────────────────────
  describe('isActiveOrder', () => {
    it('considers placed, preparing, ready as active', () => {
      expect(isActiveOrder('placed')).toBe(true);
      expect(isActiveOrder('preparing')).toBe(true);
      expect(isActiveOrder('ready')).toBe(true);
    });
    it('does not consider completed or cancelled as active', () => {
      expect(isActiveOrder('completed')).toBe(false);
      expect(isActiveOrder('cancelled')).toBe(false);
    });
  });

  it('isLiveOrder excludes only cancelled and refunded', () => {
    expect(isLiveOrder('placed')).toBe(true);
    expect(isLiveOrder('completed')).toBe(true);
    expect(isLiveOrder('cancelled')).toBe(false);
    expect(isLiveOrder('refunded')).toBe(false);
  });

  describe('isRevenueOrder (payment state, not kitchen state)', () => {
    it('never counts an unpaid order, whatever its kitchen status', () => {
      for (const status of ['placed', 'preparing', 'ready', 'completed'] as const) {
        expect(isRevenueOrder({ status, paymentStatus: 'unpaid' })).toBe(false);
      }
    });
    it('counts recorded payments and legacy orders that are still live', () => {
      expect(isRevenueOrder({ status: 'placed', paymentStatus: 'paid' })).toBe(true);
      expect(isRevenueOrder({ status: 'completed', paymentStatus: 'paid' })).toBe(true);
      expect(isRevenueOrder({ status: 'completed', paymentStatus: 'legacy_unverified' })).toBe(true);
      expect(isRevenueOrder({ status: 'completed', paymentStatus: undefined })).toBe(true);
    });
    it('excludes cancelled and refunded orders even if they were paid', () => {
      expect(isRevenueOrder({ status: 'cancelled', paymentStatus: 'paid' })).toBe(false);
      expect(isRevenueOrder({ status: 'refunded', paymentStatus: 'refunded' })).toBe(false);
    });
    it('isOutstandingPayment flags live unpaid orders only', () => {
      expect(isOutstandingPayment({ status: 'ready', paymentStatus: 'unpaid' })).toBe(true);
      expect(isOutstandingPayment({ status: 'cancelled', paymentStatus: 'unpaid' })).toBe(false);
      expect(isOutstandingPayment({ status: 'ready', paymentStatus: 'paid' })).toBe(false);
    });
  });

  // ── labels ─────────────────────────────────────────────────────
  describe('ORDER_STATUS_LABELS', () => {
    it('has labels for all statuses', () => {
      const statuses: OrderStatus[] = ['placed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];
      statuses.forEach(s => {
        expect(ORDER_STATUS_LABELS[s]).toBeTruthy();
      });
    });
  });
});
