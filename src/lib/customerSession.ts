/**
 * Customer session persistence — per device, per restaurant.
 *
 * Each phone gets a stable deviceId (smartline-device).
 * Each restaurant gets a restaurantToken embedded in its QR codes.
 *
 * The session is scoped to a single restaurant token:
 *   smartline-customer-{restaurantToken}
 *
 * A customer can only sit at one table per restaurant at a time,
 * so a single session per restaurant token is sufficient.
 * The `tableId` field inside the session records which table they're at.
 */

import type { CartItemModifier } from '@/domain/types';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Enriched cart item stored in the persisted session.
 * Includes display data so the cart can be restored without a menu lookup.
 */
export interface SessionCartItem {
  menuItemId: string;
  menuItemName: string;
  menuItemIcon: string;
  basePrice: number;
  quantity: number;
  /** Selected modifier options for this line item. */
  modifiers: CartItemModifier[];
  lineTotal: number;
}

export interface CustomerSession {
  /** Stable device identifier (never changes for this browser). */
  deviceId: string;
  /** Table the customer is/was seated at. */
  tableId: string;
  /** Active cart items — only restored if no orders have been placed yet. */
  cart: SessionCartItem[];
  /** Order IDs placed during this visit — for "Your orders so far" history. */
  placedOrderIds: string[];
  /** Last-active timestamp (ms) — used to expire stale sessions. */
  updatedAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEVICE_KEY = 'smartline-device';

/** Sessions older than 4 hours are treated as expired and ignored. */
export const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

/** Session key scoped to the restaurant token. */
const sessionKey = (restaurantToken: string) =>
  `smartline-customer-${restaurantToken}`;

// ─── Device identity ──────────────────────────────────────────────────────────

/**
 * Returns the stable device ID for this browser.
 * Generated once on first call, then persisted in localStorage forever.
 * This is what differentiates two phones sitting at the same table.
 */
export function getDeviceId(): string {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.id === 'string' && parsed.id) return parsed.id;
    }
  } catch { /* ignore parse errors */ }

  const id = `d-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify({ id })); } catch { /* ignore quota errors */ }
  return id;
}

// ─── Session I/O ──────────────────────────────────────────────────────────────

/**
 * Loads the saved session for this device at the given restaurant.
 * Returns null if no session exists or it has expired (> 4 hours old).
 */
export function loadSession(restaurantToken: string): CustomerSession | null {
  if (!restaurantToken) return null;
  try {
    const raw = localStorage.getItem(sessionKey(restaurantToken));
    if (!raw) return null;
    const session = JSON.parse(raw) as CustomerSession;
    if (!session || typeof session !== 'object') return null;
    if (Date.now() - (session.updatedAt ?? 0) > SESSION_TTL_MS) return null;
    return session;
  } catch { return null; }
}

/**
 * Persists the customer session for this restaurant.
 * Call whenever cart or placedOrderIds change.
 */
export function saveSession(
  restaurantToken: string,
  session: CustomerSession,
): void {
  if (!restaurantToken) return;
  try {
    localStorage.setItem(sessionKey(restaurantToken), JSON.stringify(session));
  } catch { /* ignore storage quota errors */ }
}

/**
 * Removes the session for this restaurant.
 * Not called automatically — TTL handles cleanup.
 */
export function clearSession(restaurantToken: string): void {
  if (!restaurantToken) return;
  try { localStorage.removeItem(sessionKey(restaurantToken)); } catch { /* ignore */ }
}
