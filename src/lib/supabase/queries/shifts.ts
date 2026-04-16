import { supabase } from '../client';
import { mapShiftRow, shiftToRow } from '../mappers';
import type { Shift } from '@/domain/types';

export async function fetchShifts(userId: string): Promise<Shift[]> {
  const { data, error } = await supabase!
    .from('shifts')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapShiftRow);
}

export async function insertShift(shift: Shift, userId: string): Promise<void> {
  const { error } = await supabase!.from('shifts').insert(shiftToRow(shift, userId));
  if (error) throw new Error(error.message);
}

export async function updateShiftRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!.from('shifts').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteShiftRow(id: string): Promise<void> {
  const { error } = await supabase!.from('shifts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
