import { supabase } from '../client';
import { mapTableRow, tableToRow } from '../mappers';
import type { Table } from '@/domain/types';

export async function fetchTables(userId: string): Promise<Table[]> {
  const { data, error } = await supabase!
    .from('tables')
    .select('*')
    .eq('user_id', userId)
    .order('number', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapTableRow);
}

export async function insertTable(table: Table, userId: string): Promise<void> {
  const { error } = await supabase!.from('tables').insert(tableToRow(table, userId));
  if (error) throw new Error(error.message);
}

export async function updateTableRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!.from('tables').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTableRow(id: string): Promise<void> {
  const { error } = await supabase!.from('tables').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
