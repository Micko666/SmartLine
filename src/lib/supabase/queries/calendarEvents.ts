import { supabase } from '../client';
import { mapCalendarEventRow, calendarEventToRow } from '../mappers';
import type { CalendarEvent } from '@/domain/types';

export async function fetchCalendarEvents(userId: string): Promise<CalendarEvent[]> {
  const { data, error } = await supabase!
    .from('calendar_events')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(mapCalendarEventRow);
}

export async function insertCalendarEvent(event: CalendarEvent, userId: string): Promise<void> {
  const { error } = await supabase!.from('calendar_events').insert(calendarEventToRow(event, userId));
  if (error) throw new Error(error.message);
}

export async function updateCalendarEventRow(
  id: string,
  updates: Partial<Record<string, unknown>>,
): Promise<void> {
  const { error } = await supabase!
    .from('calendar_events')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteCalendarEventRow(id: string): Promise<void> {
  const { error } = await supabase!.from('calendar_events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
