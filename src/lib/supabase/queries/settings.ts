import { supabase } from '../client';
import { mapSettingsRow, settingsToRow } from '../mappers';
import type { BusinessSettings } from '@/domain/types';

export async function fetchSettings(userId: string): Promise<BusinessSettings | null> {
  const { data, error } = await supabase!
    .from('business_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return mapSettingsRow(data as Record<string, unknown>);
}

export async function upsertSettings(
  settings: BusinessSettings,
  userId: string,
  nextOrderNumber?: number,
): Promise<void> {
  const row: Record<string, unknown> = {
    ...settingsToRow(settings, userId),
    ...(nextOrderNumber !== undefined ? { next_order_number: nextOrderNumber } : {}),
  };
  const { error } = await supabase!.from('business_settings').upsert(row, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

export async function fetchNextOrderNumber(userId: string): Promise<number> {
  const { data } = await supabase!
    .from('business_settings')
    .select('next_order_number')
    .eq('user_id', userId)
    .single();
  return Number((data as Record<string, unknown> | null)?.next_order_number ?? 1001);
}
