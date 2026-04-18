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

/**
 * Fetch a single receipt by ID for the public customer receipt page.
 * Uses the get_receipt_by_id SECURITY DEFINER RPC — the receipt UUID itself is
 * the capability (random v4, never leaves the customer's session/URL), and no
 * tenant table is directly readable by anon.
 */
export async function fetchReceiptById(id: string): Promise<Receipt | null> {
  const { data, error } = await supabase!.rpc('get_receipt_by_id', { p_receipt_id: id });
  if (error || !data) return null;

  const result = data as { ok: boolean } & Record<string, unknown>;
  if (!result.ok) return null;

  // RPC already returns camelCase keys that match the Receipt shape
  return {
    id:              result.id as string,
    orderId:         result.orderId as string,
    orderNumber:     result.orderNumber as number,
    tableId:         result.tableId as string,
    tableName:       result.tableName as string,
    restaurantName:  result.restaurantName as string,
    items:           result.items as Receipt['items'],
    subtotal:        Number(result.subtotal ?? 0),
    taxRate:         Number(result.taxRate ?? 0),
    taxAmount:       Number(result.taxAmount ?? 0),
    total:           Number(result.total ?? 0),
    paymentMethod:   result.paymentMethod as Receipt['paymentMethod'],
    createdAt:       result.createdAt as string,
  };
}
