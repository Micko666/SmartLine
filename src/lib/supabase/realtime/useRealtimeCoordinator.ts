/**
 * Unified realtime coordinator — single Supabase channel for the admin dashboard.
 *
 * Replaces the separate useOrdersSubscription + useMenuSubscription hooks that
 * were each managing their own channel lifecycle with no shared error state or
 * reconnection strategy.
 *
 * One channel. One cleanup path. All store updates flow through one place.
 *
 * Handles:
 *   - orders INSERT/UPDATE      → patch Zustand orders slice
 *   - kitchen_events INSERT     → prepend to kitchenEvents slice (cap 500)
 *   - menu_items UPDATE         → patch stock/status in menuItems slice
 *
 * On tab-regain (visibilitychange): targeted re-fetch of active orders only
 * (paid/preparing/ready, limit 100) to catch any missed events without a full
 * table scan.
 *
 * Mount once in DashboardLayout. Unmounts cleanly on logout / route change.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import { supabase } from '../client';
import { mapOrderRow, mapKitchenEventRow, mapCalendarEventRow } from '../mappers';
import type { OrderStatus } from '@/domain/types';

type Channel = ReturnType<NonNullable<typeof supabase>['channel']>;

const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

export function useRealtimeCoordinator() {
  const userId = useStore(s => s.user?.id);
  const channelRef = useRef<Channel | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase || !userId) return;

    // Remove any stale channel from a previous render cycle
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    channelRef.current = supabase
      .channel(`admin:${userId}`)

      // ── Orders ─────────────────────────────────────────────────────────────
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
        (payload) => {
          const newOrder = mapOrderRow(payload.new as Record<string, unknown>);
          useStore.setState(s => {
            if (s.orders.some(o => o.id === newOrder.id)) return s;
            return { orders: [newOrder, ...s.orders] };
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = mapOrderRow(payload.new as Record<string, unknown>);
          useStore.setState(s => ({
            orders: s.orders.map(o => o.id === updated.id ? updated : o),
          }));
        },
      )

      // ── Kitchen events ──────────────────────────────────────────────────────
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'kitchen_events', filter: `user_id=eq.${userId}` },
        (payload) => {
          const event = mapKitchenEventRow(payload.new as Record<string, unknown>);
          useStore.setState(s => {
            if (s.kitchenEvents.some(e => e.id === event.id)) return s;
            return { kitchenEvents: [event, ...s.kitchenEvents].slice(0, 500) };
          });
        },
      )

      // ── Menu items (stock / status changes) ────────────────────────────────
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'menu_items', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          useStore.setState(s => ({
            menuItems: s.menuItems.map(item =>
              item.id === row.id
                ? {
                    ...item,
                    stock:     row.stock != null ? Number(row.stock) : null,
                    status:    (row.status as typeof item.status) ?? item.status,
                    updatedAt: row.updated_at as string,
                  }
                : item,
            ),
          }));
        },
      )

      // ── Calendar events (customer booking requests land here) ──────────────
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'calendar_events', filter: `user_id=eq.${userId}` },
        (payload) => {
          const newEvent = mapCalendarEventRow(payload.new as Record<string, unknown>);
          useStore.setState(s => {
            if (s.calendarEvents.some(e => e.id === newEvent.id)) return s;
            return { calendarEvents: [newEvent, ...s.calendarEvents] };
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'calendar_events', filter: `user_id=eq.${userId}` },
        (payload) => {
          const updated = mapCalendarEventRow(payload.new as Record<string, unknown>);
          useStore.setState(s => ({
            calendarEvents: s.calendarEvents.map(e => e.id === updated.id ? updated : e),
          }));
        },
      )

      .subscribe();

    // Tab-regain: fetch only active orders to catch any missed realtime events.
    // Merges with historical orders already in the store.
    async function onVisible() {
      if (document.visibilityState !== 'visible' || !supabase) return;
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', userId)
        .in('status', ACTIVE_STATUSES)
        .order('created_at', { ascending: false })
        .limit(100);
      if (!data) return;
      const freshActive = (data as Record<string, unknown>[]).map(mapOrderRow);
      useStore.setState(s => {
        const historical = s.orders.filter(
          o => !ACTIVE_STATUSES.includes(o.status as OrderStatus),
        );
        return { orders: [...freshActive, ...historical] };
      });
    }
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (channelRef.current && supabase) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);
}
