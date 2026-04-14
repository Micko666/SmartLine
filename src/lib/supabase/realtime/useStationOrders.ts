/**
 * Hook for station devices to load and auto-refresh orders.
 *
 * Two-mode design:
 *
 *  Supabase mode (VITE_SUPABASE_URL set):
 *    1. Supabase Realtime channel — instant re-fetch on INSERT/UPDATE
 *    2. 30-second backup poll in case the websocket drops
 *    3. visibilitychange re-fetch when tab regains focus
 *
 *  localStorage mode (no Supabase / demo):
 *    Reads directly from the Zustand store and wraps store actions.
 *    Stations work fully in demo mode on the same device.
 *    `online` is always true in local mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../client';
import { mapOrderRow } from '../mappers';
import { useStore } from '@/store';
import type { Order, OrderStatus, Table } from '@/domain/types';

const POLL_INTERVAL_MS = 30_000;
const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

type SupabaseChannel = ReturnType<NonNullable<typeof supabase>['channel']>;

export type KitchenEventType = 'delay' | 'remake' | 'waste' | 'note';

export function useStationOrders(restaurantToken: string, userId?: string) {
  const isLocal = !supabase;

  // ── Store subscriptions (always called — hook rules) ──────────────────────
  const storeOrders = useStore(s => s.orders);

  // ── Supabase-mode state ────────────────────────────────────────────────────
  const [remoteOrders, setRemoteOrders] = useState<Order[]>([]);
  const [online, setOnline] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRemote = useCallback(async () => {
    if (isLocal || !supabase) return;
    try {
      const { data, error } = await supabase.rpc('station_get_orders', {
        p_restaurant_token: restaurantToken,
      });
      if (error || !data) { setOnline(false); return; }
      const result = data as { ok: boolean; orders: Record<string, unknown>[] };
      if (result.ok) {
        setRemoteOrders((result.orders ?? []).map(mapOrderRow));
        setOnline(true);
      }
    } catch {
      setOnline(false);
    }
  }, [isLocal, restaurantToken]);

  useEffect(() => {
    if (isLocal) return;
    fetchRemote();
    timer.current = setInterval(fetchRemote, POLL_INTERVAL_MS);

    let channel: SupabaseChannel | null = null;
    if (supabase && userId) {
      channel = supabase
        .channel(`station:${restaurantToken}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
          () => fetchRemote(),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
          () => fetchRemote(),
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'tables', filter: `user_id=eq.${userId}` },
          (payload) => {
            const row = payload.new as { id: string; status: string };
            useStore.setState(s => ({
              tables: s.tables.map(t =>
                t.id === row.id ? { ...t, status: row.status as Table['status'] } : t,
              ),
            }));
          },
        )
        .subscribe();
    }

    const onVisible = () => { if (document.visibilityState === 'visible') fetchRemote(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      if (timer.current) clearInterval(timer.current);
      if (supabase && channel) supabase.removeChannel(channel);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchRemote, isLocal, userId]);

  // ── Action implementations ─────────────────────────────────────────────────

  // Local (store-backed) actions
  const localAdvanceOrder = useCallback(async (orderId: string, newStatus: string): Promise<boolean> => {
    if (newStatus === 'cancelled') {
      useStore.getState().cancelOrder(orderId);
    } else {
      useStore.getState().advanceOrderStatus(orderId);
    }
    return true;
  }, []);

  const localAdjustPrepTime = useCallback(async (orderId: string, deltaMinutes: number): Promise<boolean> => {
    useStore.getState().adjustPrepTime(orderId, deltaMinutes);
    return true;
  }, []);

  const localLogKitchenEvent = useCallback(async (payload: {
    orderId: string;
    orderNumber: number;
    type: KitchenEventType;
    notes: string;
    menuItemId?: string;
    menuItemName?: string;
    quantity?: number;
  }): Promise<boolean> => {
    useStore.getState().logKitchenEvent(payload);
    return true;
  }, []);

  const localRemakeOrder = useCallback(async (orderId: string, notes: string): Promise<boolean> => {
    const order = useStore.getState().orders.find(o => o.id === orderId);
    if (order) {
      useStore.getState().logKitchenEvent({
        orderId,
        orderNumber: order.orderNumber,
        type: 'remake',
        notes: notes || 'Sent back for rework',
      });
    }
    useStore.getState().advanceOrderStatus(orderId);
    return true;
  }, []);

  // Remote (Supabase) actions
  const remoteAdvanceOrder = useCallback(async (orderId: string, newStatus: string): Promise<boolean> => {
    if (!supabase) return false;
    const { data, error } = await supabase.rpc('station_advance_order', {
      p_restaurant_token: restaurantToken,
      p_order_id: orderId,
      p_new_status: newStatus,
    });
    if (error || !(data as { ok: boolean }).ok) return false;
    const updatedAt = new Date().toISOString();
    // Patch station-local orders
    setRemoteOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, status: newStatus as Order['status'], updatedAt } : o,
    ));
    // Also patch the central Zustand store so admin views reflect the change
    // immediately without waiting for the next realtime event
    useStore.setState(s => ({
      orders: s.orders.map(o =>
        o.id === orderId ? { ...o, status: newStatus as Order['status'], updatedAt } : o,
      ),
    }));
    return true;
  }, [restaurantToken]);

  const remoteAdjustPrepTime = useCallback(async (orderId: string, deltaMinutes: number): Promise<boolean> => {
    if (!supabase) return false;
    const { data, error } = await supabase.rpc('station_adjust_prep_time', {
      p_restaurant_token: restaurantToken,
      p_order_id: orderId,
      p_delta_minutes: deltaMinutes,
    });
    if (error || !(data as { ok: boolean }).ok) return false;
    setRemoteOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, prepTimeAdjustment: o.prepTimeAdjustment + deltaMinutes } : o,
    ));
    useStore.setState(s => ({
      orders: s.orders.map(o =>
        o.id === orderId ? { ...o, prepTimeAdjustment: o.prepTimeAdjustment + deltaMinutes } : o,
      ),
    }));
    return true;
  }, [restaurantToken]);

  const remoteLogKitchenEvent = useCallback(async (payload: {
    orderId: string;
    orderNumber: number;
    type: KitchenEventType;
    notes: string;
    menuItemId?: string;
    menuItemName?: string;
    quantity?: number;
  }): Promise<boolean> => {
    if (!supabase) return false;
    const { data, error } = await supabase.rpc('station_log_kitchen_event', {
      p_restaurant_token: restaurantToken,
      p_id: crypto.randomUUID(),
      p_order_id: payload.orderId,
      p_order_number: payload.orderNumber,
      p_type: payload.type,
      p_notes: payload.notes,
      p_menu_item_id: payload.menuItemId ?? null,
      p_menu_item_name: payload.menuItemName ?? null,
      p_quantity: payload.quantity ?? null,
    });
    if (error || !(data as { ok: boolean }).ok) return false;
    return true;
  }, [restaurantToken]);

  const remoteRemakeOrder = useCallback(async (orderId: string, notes: string): Promise<boolean> => {
    const order = remoteOrders.find(o => o.id === orderId);
    if (order) {
      await remoteLogKitchenEvent({
        orderId,
        orderNumber: order.orderNumber,
        type: 'remake',
        notes: notes || 'Sent back for rework',
      });
    }
    return remoteAdvanceOrder(orderId, 'preparing');
  }, [remoteOrders, remoteLogKitchenEvent, remoteAdvanceOrder]);

  // ── Return unified interface ───────────────────────────────────────────────

  const orders = isLocal
    ? storeOrders.filter(o => ACTIVE_STATUSES.includes(o.status as OrderStatus))
    : remoteOrders;

  return {
    orders,
    online:          isLocal ? true : online,
    refetch:         isLocal ? async () => {} : fetchRemote,
    advanceOrder:    isLocal ? localAdvanceOrder    : remoteAdvanceOrder,
    adjustPrepTime:  isLocal ? localAdjustPrepTime  : remoteAdjustPrepTime,
    logKitchenEvent: isLocal ? localLogKitchenEvent : remoteLogKitchenEvent,
    remakeOrder:     isLocal ? localRemakeOrder     : remoteRemakeOrder,
  };
}
