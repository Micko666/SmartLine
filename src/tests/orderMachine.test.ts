import { describe, it, expect } from 'vitest';
import {
  canTransition, transition, advance, nextStatuses,
  isActiveOrder, isRevenueOrder, ORDER_STATUS_LABELS,
} from '../domain/orderMachine';
import type { OrderStatus } from '../domain/types';

describe('orderMachine', () => {
  // ── canTransition ──────────────────────────────────────────────
  describe('canTransition', () => {
    it('allows paid → preparing', () => {
      expect(canTransition('paid', 'preparing')).toBe(true);
    });
    it('allows paid → cancelled', () => {
      expect(canTransition('paid', 'cancelled')).toBe(true);
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
    it('blocks paid → completed (skip steps)', () => {
      expect(canTransition('paid', 'completed')).toBe(false);
    });
    it('blocks completed → preparing (backwards)', () => {
      expect(canTransition('completed', 'preparing')).toBe(false);
    });
    it('blocks refunded → anything (terminal)', () => {
      const allStatuses: OrderStatus[] = ['paid', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];
      allStatuses.forEach(s => {
        expect(canTransition('refunded', s)).toBe(false);
      });
    });
    it('blocks completed → anything (terminal)', () => {
      const allStatuses: OrderStatus[] = ['paid', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];
      allStatuses.forEach(s => {
        expect(canTransition('completed', s)).toBe(false);
      });
    });
  });

  // ── transition ─────────────────────────────────────────────────
  describe('transition', () => {
    it('returns new status on valid transition', () => {
      expect(transition('paid', 'preparing')).toBe('preparing');
    });
    it('throws on invalid transition', () => {
      expect(() => transition('paid', 'completed')).toThrow();
    });
    it('throws on backwards transition', () => {
      expect(() => transition('ready', 'paid')).toThrow();
    });
  });

  // ── advance ────────────────────────────────────────────────────
  describe('advance', () => {
    it('advances paid → preparing (skips cancelled as primary)', () => {
      expect(advance('paid')).toBe('preparing');
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
    it('returns all valid next statuses for paid', () => {
      const nexts = nextStatuses('paid');
      expect(nexts).toContain('preparing');
      expect(nexts).toContain('cancelled');
    });
    it('returns empty array for completed', () => {
      expect(nextStatuses('completed')).toHaveLength(0);
    });
  });

  // ── helper flags ───────────────────────────────────────────────
  describe('isActiveOrder', () => {
    it('considers paid, preparing, ready as active', () => {
      expect(isActiveOrder('paid')).toBe(true);
      expect(isActiveOrder('preparing')).toBe(true);
      expect(isActiveOrder('ready')).toBe(true);
    });
    it('does not consider completed or cancelled as active', () => {
      expect(isActiveOrder('completed')).toBe(false);
      expect(isActiveOrder('cancelled')).toBe(false);
    });
  });

  describe('isRevenueOrder', () => {
    it('counts paid, preparing, ready, completed as revenue', () => {
      expect(isRevenueOrder('paid')).toBe(true);
      expect(isRevenueOrder('completed')).toBe(true);
    });
    it('excludes cancelled and refunded from revenue', () => {
      expect(isRevenueOrder('cancelled')).toBe(false);
      expect(isRevenueOrder('refunded')).toBe(false);
    });
  });

  // ── labels ─────────────────────────────────────────────────────
  describe('ORDER_STATUS_LABELS', () => {
    it('has labels for all statuses', () => {
      const statuses: OrderStatus[] = ['paid', 'preparing', 'ready', 'completed', 'cancelled', 'refunded'];
      statuses.forEach(s => {
        expect(ORDER_STATUS_LABELS[s]).toBeTruthy();
      });
    });
  });
});
