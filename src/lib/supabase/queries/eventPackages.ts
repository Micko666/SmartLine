import { supabase } from '../client';
import { mapEventPackageRow, eventPackageToRow } from '../mappers';
import type { EventPackage } from '@/domain/types';

export async function fetchEventPackages(userId: string): Promise<EventPackage[]> {
  const { data, error } = await supabase!
    .from('event_packages')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapEventPackageRow);
}

export async function insertEventPackage(pkg: EventPackage, userId: string): Promise<void> {
  const { error } = await supabase!.from('event_packages').insert(eventPackageToRow(pkg, userId));
  if (error) throw new Error(error.message);
}

export async function updateEventPackageRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!.from('event_packages').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteEventPackageRow(id: string): Promise<void> {
  const { error } = await supabase!.from('event_packages').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
