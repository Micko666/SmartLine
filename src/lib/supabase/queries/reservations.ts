import { supabase } from '../client';
import { mapReservationRow } from '../mappers';
import type { StockReservation } from '@/domain/types';

export async function fetchReservations(userId: string): Promise<StockReservation[]> {
  const { data, error } = await supabase!
    .from('stock_reservations')
    .select('*')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString());
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapReservationRow);
}

export async function insertReservation(
  reservation: StockReservation,
  userId: string,
): Promise<void> {
  const { error } = await supabase!.from('stock_reservations').insert({
    id:         reservation.id,
    user_id:    userId,
    session_id: reservation.sessionId,
    items:      reservation.items,
    expires_at: new Date(reservation.expiresAt).toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteReservationBySession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase!
    .from('stock_reservations')
    .delete()
    .eq('session_id', sessionId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}
