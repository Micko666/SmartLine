import { supabase } from '../client';
import { mapOrderRow } from '../mappers';
import type { Order } from '@/domain/types';

/** Same retention as local mode: last 90 days plus every still-active order. */
export const ORDER_HISTORY_DAYS = 90;

export async function fetchOrders(userId: string, historyDays = ORDER_HISTORY_DAYS): Promise<Order[]> {
  const since = new Date(Date.now() - historyDays * 86_400_000).toISOString();
  const { data, error } = await supabase!
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .or(`created_at.gte.${since},status.in.(paid,preparing,ready)`)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapOrderRow);
}

export async function updateOrderRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!
    .from('orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
