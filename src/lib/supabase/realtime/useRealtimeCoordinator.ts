/**
 * Unified realtime coordinator — single Supabase channel for the admin
 * dashboard (authenticated owner; RLS limits events to the owner's rows).
 *
 * Handles:
 *   - orders INSERT/UPDATE        → applyRemoteOrder
 *   - kitchen_events INSERT       → applyRemoteKitchenEvent
 *   - menu_items UPDATE           → applyRemoteMenuItem
 *   - tables UPDATE               → applyRemoteTable (station/table changes)
 *   - calendar_events INSERT/UPDATE → applyRemoteCalendarEvent
 *
 * On tab-regain (visibilitychange): re-fetch active orders AND every order the
 * store still believes is active, then merge by id — so an order completed
 * while the tab was hidden is updated instead of disappearing.
 *
 * All writes go through store actions; this hook never calls setState.
 * Mount once in DashboardLayout.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import { isActiveOrder } from '@/domain/orderMachine';
import { supabase } from '../client';
import { mapOrderRow, mapKitchenEventRow, mapCalendarEventRow, mapMenuItemRow, mapTableRow } from '../mappers';

type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;
type Row = Record<string, unknown>;

export function useRealtimeCoordinator() {
  const userId = useStore(s => s.user?.id);
  const channelRef = useRef<Channel | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase || !userId) return;
    const client = supabase;
    const store = () => useStore.getState();
    const filter = `user_id=eq.${userId}`;

    if (channelRef.current) {
      client.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    channelRef.current = client
      .channel(`admin:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter },
        payload => store().applyRemoteOrder(mapOrderRow(payload.new as Row)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter },
        payload => store().applyRemoteOrder(mapOrderRow(payload.new as Row)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'kitchen_events', filter },
        payload => store().applyRemoteKitchenEvent(mapKitchenEventRow(payload.new as Row)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_items', filter },
        payload => store().applyRemoteMenuItem(mapMenuItemRow(payload.new as Row)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tables', filter },
        payload => store().applyRemoteTable(mapTableRow(payload.new as Row)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_events', filter },
        payload => store().applyRemoteCalendarEvent(mapCalendarEventRow(payload.new as Row)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calendar_events', filter },
        payload => store().applyRemoteCalendarEvent(mapCalendarEventRow(payload.new as Row)))
      .subscribe();

    async function onVisible() {
      if (document.visibilityState !== 'visible') return;
      const staleActiveIds = store().orders.filter(o => isActiveOrder(o.status)).map(o => o.id);
      const [active, stale] = await Promise.all([
        client.from('orders').select('*').eq('user_id', userId).in('status', ['paid', 'preparing', 'ready'])
          .order('created_at', { ascending: false }).limit(500),
        staleActiveIds.length
          ? client.from('orders').select('*').eq('user_id', userId).in('id', staleActiveIds)
          : Promise.resolve({ data: [] as Row[] }),
      ]);
      const rows = [...((active.data ?? []) as Row[]), ...((stale.data ?? []) as Row[])];
      if (rows.length) store().mergeRemoteOrders(rows.map(mapOrderRow));
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (channelRef.current) {
        client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);
}
