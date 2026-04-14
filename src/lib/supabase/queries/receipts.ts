import { supabase } from '../client';
import { mapReceiptRow } from '../mappers';
import type { Receipt } from '@/domain/types';

export async function fetchReceipts(userId: string): Promise<Receipt[]> {
  const { data, error } = await supabase!
    .from('receipts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapReceiptRow);
}

/** Fetch a single receipt by ID — used by the public customer receipt page. */
export async function fetchReceiptById(id: string): Promise<Receipt | null> {
  const { data, error } = await supabase!
    .from('receipts')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return mapReceiptRow(data as Record<string, unknown>);
}
