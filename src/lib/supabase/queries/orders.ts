import { supabase } from '../client';
import { mapOrderRow } from '../mappers';
import type { Order } from '@/domain/types';

export async function fetchOrders(userId: string): Promise<Order[]> {
  const { data, error } = await supabase!
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
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
