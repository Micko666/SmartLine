import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDeviceId,
  loadSession,
  saveSession,
  clearSession,
  SESSION_TTL_MS,
  type CustomerSession,
} from '@/lib/customerSession';

// ─── localStorage mock ───────────────────────────────────────────────────────

const store: Record<string, string> = {};

beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    },
    writable: true,
    configurable: true,
  });
});

// ─── getDeviceId ─────────────────────────────────────────────────────────────

describe('getDeviceId', () => {
  it('returns a non-empty string', () => {
    expect(typeof getDeviceId()).toBe('string');
    expect(getDeviceId().length).toBeGreaterThan(0);
  });

  it('returns the same ID on subsequent calls (stable per device)', () => {
    const id1 = getDeviceId();
    const id2 = getDeviceId();
    expect(id1).toBe(id2);
  });

  it('returns the same ID after a new instance reads the same localStorage', () => {
    const id1 = getDeviceId();
    // Simulate a fresh call — the ID is already in localStorage
    const id2 = getDeviceId();
    expect(id1).toBe(id2);
  });
});

// ─── loadSession ─────────────────────────────────────────────────────────────

describe('loadSession', () => {
  it('returns null when no session exists', () => {
    expect(loadSession('token-abc')).toBeNull();
  });

  it('returns null for an empty restaurantToken', () => {
    expect(loadSession('')).toBeNull();
  });

  it('returns null for a corrupted JSON value', () => {
    store['smartline-customer-bad'] = 'not-json{{{';
    expect(loadSession('bad')).toBeNull();
  });

  it('returns null when session is expired (older than SESSION_TTL_MS)', () => {
    const session: CustomerSession = {
      deviceId: 'd-test',
      tableId: 'tbl-1',
      cart: [],
      placedOrderIds: [],
      updatedAt: Date.now() - SESSION_TTL_MS - 1000,
    };
    store['smartline-customer-exp'] = JSON.stringify(session);
    expect(loadSession('exp')).toBeNull();
  });

  it('returns the session when it is within TTL', () => {
    const session: CustomerSession = {
      deviceId: 'd-test',
      tableId: 'tbl-1',
      cart: [],
      placedOrderIds: [],
      updatedAt: Date.now() - 1000,
    };
    store['smartline-customer-fresh'] = JSON.stringify(session);
    const loaded = loadSession('fresh');
    expect(loaded).not.toBeNull();
    expect(loaded!.tableId).toBe('tbl-1');
  });
});

// ─── saveSession + loadSession round-trip ────────────────────────────────────

describe('saveSession / loadSession round-trip', () => {
  it('persists and restores all session fields', () => {
    const session: CustomerSession = {
      deviceId: 'd-abc123',
      tableId: 'tbl-5',
      cart: [
        {
          menuItemId: 'item-1',
          menuItemName: 'Burger',
          menuItemIcon: '🍔',
          basePrice: 9.99,
          quantity: 2,
          modifiers: [],
          lineTotal: 19.98,
        },
      ],
      placedOrderIds: ['ord-1', 'ord-2'],
      updatedAt: Date.now(),
    };

    saveSession('rest-token', session);
    const loaded = loadSession('rest-token');

    expect(loaded).not.toBeNull();
    expect(loaded!.deviceId).toBe('d-abc123');
    expect(loaded!.tableId).toBe('tbl-5');
    expect(loaded!.cart).toHaveLength(1);
    expect(loaded!.cart[0].menuItemName).toBe('Burger');
    expect(loaded!.cart[0].lineTotal).toBe(19.98);
    expect(loaded!.placedOrderIds).toEqual(['ord-1', 'ord-2']);
  });

  it('overwrites the previous session on subsequent saves', () => {
    const base: CustomerSession = {
      deviceId: 'd-x', tableId: 'tbl-1', cart: [], placedOrderIds: [], updatedAt: Date.now(),
    };
    saveSession('tok', base);
    saveSession('tok', { ...base, tableId: 'tbl-2' });

    const loaded = loadSession('tok');
    expect(loaded!.tableId).toBe('tbl-2');
  });
});

// ─── clearSession ─────────────────────────────────────────────────────────────

describe('clearSession', () => {
  it('removes the session so loadSession returns null', () => {
    const session: CustomerSession = {
      deviceId: 'd-del', tableId: 'tbl-1', cart: [], placedOrderIds: [], updatedAt: Date.now(),
    };
    saveSession('tok-del', session);
    expect(loadSession('tok-del')).not.toBeNull();

    clearSession('tok-del');
    expect(loadSession('tok-del')).toBeNull();
  });

  it('is a no-op for an empty token', () => {
    expect(() => clearSession('')).not.toThrow();
  });

  it('is a no-op when session does not exist', () => {
    expect(() => clearSession('nonexistent')).not.toThrow();
  });
});

// ─── Multi-restaurant isolation ───────────────────────────────────────────────

describe('multi-restaurant isolation', () => {
  it('sessions for different tokens are completely independent', () => {
    const sessionA: CustomerSession = {
      deviceId: 'd-1', tableId: 'tblA', cart: [], placedOrderIds: ['ord-A'], updatedAt: Date.now(),
    };
    const sessionB: CustomerSession = {
      deviceId: 'd-1', tableId: 'tblB', cart: [], placedOrderIds: ['ord-B'], updatedAt: Date.now(),
    };

    saveSession('restaurant-alpha', sessionA);
    saveSession('restaurant-beta', sessionB);

    expect(loadSession('restaurant-alpha')!.placedOrderIds).toEqual(['ord-A']);
    expect(loadSession('restaurant-beta')!.placedOrderIds).toEqual(['ord-B']);
  });

  it('clearing one restaurant session does not affect another', () => {
    const session: CustomerSession = {
      deviceId: 'd-1', tableId: 'tbl-1', cart: [], placedOrderIds: [], updatedAt: Date.now(),
    };

    saveSession('r1', session);
    saveSession('r2', session);

    clearSession('r1');

    expect(loadSession('r1')).toBeNull();
    expect(loadSession('r2')).not.toBeNull();
  });

  it('expired session at one restaurant does not affect a fresh session at another', () => {
    const expired: CustomerSession = {
      deviceId: 'd-1', tableId: 'tbl-1', cart: [], placedOrderIds: [],
      updatedAt: Date.now() - SESSION_TTL_MS - 5000,
    };
    const fresh: CustomerSession = {
      deviceId: 'd-1', tableId: 'tbl-1', cart: [], placedOrderIds: [],
      updatedAt: Date.now(),
    };

    saveSession('r-expired', expired);
    saveSession('r-fresh', fresh);

    expect(loadSession('r-expired')).toBeNull();
    expect(loadSession('r-fresh')).not.toBeNull();
  });
});

// ─── saveSession no-op guard ─────────────────────────────────────────────────

describe('saveSession edge cases', () => {
  it('is a no-op for an empty restaurantToken', () => {
    const session: CustomerSession = {
      deviceId: 'd-1', tableId: 'tbl-1', cart: [], placedOrderIds: [], updatedAt: Date.now(),
    };
    expect(() => saveSession('', session)).not.toThrow();
    // Nothing should have been written
    expect(Object.keys(store).filter(k => k.startsWith('smartline-customer-'))).toHaveLength(0);
  });
});
