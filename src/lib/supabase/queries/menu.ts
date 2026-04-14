import { supabase } from '../client';
import { mapMenuItemRow, menuItemToRow } from '../mappers';
import type { MenuItem } from '@/domain/types';

export async function fetchMenuItems(userId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase!
    .from('menu_items')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapMenuItemRow);
}

export async function insertMenuItem(item: MenuItem, userId: string): Promise<void> {
  const row = menuItemToRow(item, userId);
  const { error } = await supabase!.from('menu_items').insert({ ...row, created_at: item.createdAt, updated_at: item.updatedAt });
  if (error) throw new Error(error.message);
}

export async function updateMenuItemRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!.from('menu_items').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteMenuItemRow(id: string): Promise<void> {
  const { error } = await supabase!.from('menu_items').update({ status: 'archived', updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function bulkUpdateSortOrder(items: { id: string; sortOrder: number }[]): Promise<void> {
  await Promise.all(
    items.map(async ({ id, sortOrder }) => {
      const { error } = await supabase!.from('menu_items').update({ sort_order: sortOrder }).eq('id', id);
      if (error) throw new Error(error.message);
    }),
  );
}
