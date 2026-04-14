import { supabase } from '../client';
import { mapKitchenEventRow, kitchenEventToRow } from '../mappers';
import type { KitchenEvent } from '@/domain/types';

export async function fetchKitchenEvents(userId: string): Promise<KitchenEvent[]> {
  const { data, error } = await supabase!
    .from('kitchen_events')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapKitchenEventRow);
}

export async function insertKitchenEvent(event: KitchenEvent, userId: string): Promise<void> {
  const row = kitchenEventToRow(event, userId);
  const { error } = await supabase!.from('kitchen_events').insert({
    ...row,
    created_at: event.createdAt,
  });
  if (error) throw new Error(error.message);
}
