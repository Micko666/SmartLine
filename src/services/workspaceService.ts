import { supabase } from '@/lib/supabase/client';
import { mapOrderRow, mapMenuItemRow, mapSettingsRow, settingsToRow } from '@/lib/supabase/mappers';
import { fetchMenuItems } from '@/lib/supabase/queries/menu';
import { fetchTables } from '@/lib/supabase/queries/tables';
import { DEFAULT_SETTINGS } from '@/domain/initialData';
import { normalizeStation } from '@/domain/stations';
import type { BusinessSettings, MenuItem, OrderStatus, Station } from '@/domain/types';

async function rpc(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const result = data as Record<string, unknown> | null;
  if (!result?.ok) throw new Error(String(result?.error ?? 'Operation failed.'));
  return result;
}

/** Business mutations apply authoritative results, never a stale client stock snapshot. */
export async function transitionOrder(orderId: string, expected: OrderStatus, next: OrderStatus) {
  const result = await rpc('advance_order', { p_order_id: orderId, p_expected_status: expected, p_new_status: next });
  return mapOrderRow(result.order as Record<string, unknown>);
}

export async function recordPayment(orderId: string) {
  const result = await rpc('record_payment', { p_order_id: orderId });
  return mapOrderRow(result.order as Record<string, unknown>);
}

export async function cancelOrder(orderId: string, userId: string) {
  const result = await rpc('cancel_order', { p_order_id: orderId });
  // Cancel and restock are one DB transaction. Refresh the projections afterward.
  const [menuItems, tables] = await Promise.all([fetchMenuItems(userId), fetchTables(userId)]);
  return { order: mapOrderRow(result.order as Record<string, unknown>), menuItems, tables };
}

export async function adjustStock(itemId: string, delta: number) {
  const result = await rpc('adjust_stock', { p_item_id: itemId, p_delta: delta });
  return mapMenuItemRow(result.item as Record<string, unknown>);
}

/** Absolute stock entry uses compare-and-swap so a checkout cannot be overwritten. */
export async function setStock(item: MenuItem, stock: number) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.from('menu_items')
    .update({ stock, updated_at: new Date().toISOString() })
    .eq('id', item.id).eq('updated_at', item.updatedAt).select('*').single();
  if (error || !data) throw new Error('Stock changed on another device. Refresh and try again.');
  return mapMenuItemRow(data as Record<string, unknown>);
}

export async function patchSettings(updates: Partial<BusinessSettings>) {
  const fields = Object.keys(updates).filter(key => key !== 'stations') as (keyof BusinessSettings)[];
  const row = settingsToRow({ ...DEFAULT_SETTINGS, ...updates }, '');
  const baseline = settingsToRow(DEFAULT_SETTINGS, '');
  // Compare one field at a time to reuse the schema mapper without sending defaults.
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const single = settingsToRow({ ...DEFAULT_SETTINGS, [field]: updates[field] }, '');
    for (const key of Object.keys(single)) {
      if (JSON.stringify(single[key]) !== JSON.stringify(baseline[key])) patch[key] = row[key];
    }
    // A field explicitly reset to its default must still be sent.
    const snake = field.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`);
    if (snake in row) patch[snake] = row[snake];
  }
  const result = await rpc('patch_settings', { p_patch: patch });
  return mapSettingsRow(result.settings as Record<string, unknown>);
}

export async function listStations(): Promise<Station[]> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('list_stations');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Station[]).map(station => normalizeStation({ ...station, pin: '' }));
}

export async function saveStation(station: Station): Promise<Station> {
  const result = await rpc('upsert_station', { p_station: station });
  return normalizeStation({ ...(result.station as Station), pin: '' });
}

export async function deleteStation(id: string): Promise<void> {
  await rpc('delete_station', { p_station_id: id });
}
