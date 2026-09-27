/**
 * Station device API (Supabase mode). Every call after login carries the
 * opaque session token returned by `station_login`; the server checks the
 * session, the station's permissions and the order state machine.
 * The PIN is never downloaded: it is sent once to `station_login`.
 */
import { supabase } from '@/lib/supabase/client';
import { mapMenuItemRow, mapOrderRow, mapTableRow } from '@/lib/supabase/mappers';
import { normalizeStation } from '@/domain/stations';
import type { MapDecoration, MenuItem, Order, OrderStatus, Station, Table, TableStatus } from '@/domain/types';

const SESSION_KEY = (stationId: string) => `sl-station-session-${stationId}`;

export interface StationSession { token: string; expiresAt: string }

export function loadStationSession(stationId: string): StationSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(SESSION_KEY(stationId)) ?? 'null') as StationSession | null;
    return value && typeof value.token === 'string' && Date.parse(value.expiresAt) > Date.now() ? value : null;
  } catch { return null; }
}

export function saveStationSession(stationId: string, session: StationSession) {
  try { localStorage.setItem(SESSION_KEY(stationId), JSON.stringify(session)); } catch { /* storage unavailable */ }
}

export function clearStationSession(stationId: string) {
  try { localStorage.removeItem(SESSION_KEY(stationId)); } catch { /* storage unavailable */ }
}

async function call<T extends Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as T & { ok?: boolean; error?: string };
  if (!result.ok) throw new Error(result.error ?? 'Station request failed.');
  return result;
}

function toStation(raw: Record<string, unknown>): Station {
  return normalizeStation({ ...(raw as unknown as Station), pin: '', hasPin: Boolean(raw.hasPin) });
}

export async function fetchStationConfig(restaurantToken: string, stationId: string) {
  const r = await call<{ station: Record<string, unknown>; restaurantName: string }>('station_public_config', { p_restaurant_token: restaurantToken, p_station_id: stationId });
  return { station: toStation(r.station), restaurantName: r.restaurantName };
}

export async function loginStation(restaurantToken: string, stationId: string, pin: string | null): Promise<StationSession> {
  const r = await call<{ sessionToken: string; expiresAt: string }>('station_login', { p_restaurant_token: restaurantToken, p_station_id: stationId, p_pin: pin });
  const session = { token: r.sessionToken, expiresAt: r.expiresAt };
  saveStationSession(stationId, session);
  return session;
}

export async function logoutStation(stationId: string) {
  const session = loadStationSession(stationId);
  clearStationSession(stationId);
  if (session && supabase) await supabase.rpc('station_logout', { p_session_token: session.token });
}

export interface StationContext {
  restaurantName: string;
  station: Station;
  menuItems: MenuItem[];
  tables: Table[];
  decorations: MapDecoration[];
}

export async function fetchStationContext(token: string): Promise<StationContext> {
  const r = await call<{ restaurantName: string; station: Record<string, unknown>; menuItems: Record<string, unknown>[]; tables: Record<string, unknown>[]; decorations: MapDecoration[] }>('station_get_context', { p_session_token: token });
  return {
    restaurantName: r.restaurantName,
    station: toStation(r.station),
    menuItems: r.menuItems.map(mapMenuItemRow),
    tables: r.tables.map(mapTableRow),
    decorations: r.decorations,
  };
}

export async function fetchStationOrders(token: string): Promise<Order[]> {
  const r = await call<{ orders: Record<string, unknown>[] }>('station_get_orders', { p_session_token: token });
  return r.orders.map(mapOrderRow);
}

export async function stationTransition(token: string, orderId: string, expected: OrderStatus, next: OrderStatus): Promise<Order> {
  const r = await call<{ order: Record<string, unknown> }>('station_advance_order', { p_session_token: token, p_order_id: orderId, p_expected_status: expected, p_new_status: next });
  return mapOrderRow(r.order);
}

export async function stationAdjustPrepTime(token: string, orderId: string, deltaMinutes: number): Promise<Order> {
  const r = await call<{ order: Record<string, unknown> }>('station_adjust_prep_time', { p_session_token: token, p_order_id: orderId, p_delta_minutes: deltaMinutes });
  return mapOrderRow(r.order);
}

export async function stationLogEvent(token: string, e: { orderId: string; type: string; notes: string; menuItemId?: string; menuItemName?: string; quantity?: number }) {
  await call('station_log_kitchen_event', {
    p_session_token: token, p_order_id: e.orderId, p_type: e.type, p_notes: e.notes,
    p_menu_item_id: e.menuItemId ?? null, p_menu_item_name: e.menuItemName ?? null, p_quantity: e.quantity ?? null,
  });
}

export async function stationSetTableStatus(token: string, tableId: string, status: TableStatus): Promise<Table> {
  const r = await call<{ table: Record<string, unknown> }>('station_set_table_status', { p_session_token: token, p_table_id: tableId, p_status: status });
  return mapTableRow(r.table);
}
