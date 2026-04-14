/**
 * Real-time orders subscription — keeps the admin order queue up to date
 * across all devices for the same restaurant.
 *
 * Mount once in DashboardLayout. Unmounts cleanly on logout / route change.
 *
 * Strategy:
 *  1. Supabase Realtime channel — instant in-place patch on INSERT/UPDATE.
 *     Event-driven; zero DB queries unless an order actually changes.
 *  2. visibilitychange — when the admin switches back to this tab, fetch ONLY
 *     the active (paid/preparing/ready) orders with LIMIT 50. This catches any
 *     missed events without doing a full table scan every 30 seconds.
 *
 * Previously used a 30-second full table poll which caused statement timeouts
 * on the free Supabase tier, breaking station RPC calls and slowing the
 * customer menu. Polling has been removed.
 */
import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import { supabase } from '../client';
import { mapOrderRow, mapKitchenEventRow } from '../mappers';
import type { OrderStatus } from '@/domain/types';

type SupabaseChannel = NonNullable<typeof supabase> extends { channel: (...a: unknown[]) => infer C } ? C : never;

const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

export function useOrdersSubscription() {
  const userId = useStore(s => s.user?.id);
  const channelRef = useRef<SupabaseChannel | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase || !userId) return;

    // Remove stale channel from a previous run
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    // Realtime: in-place patch — no DB query on each event
    channelRef.current = supabase
      .channel(`admin-orders:${userId}`)
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
      .subscribe();

    // visibilitychange: targeted fetch of only active orders when tab regains focus.
    // Limited to 50 rows — fast even without a covering index. Merges with the
    // existing store so historical orders (completed/cancelled) are preserved.
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
        const historical = s.orders.filter(o => !ACTIVE_STATUSES.includes(o.status as OrderStatus));
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
