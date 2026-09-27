/**
 * Orders + actions for a station device.
 *
 *  Supabase mode: every call carries the station session token; the server
 *    checks the session, the station's permissions and the order state
 *    machine. Anonymous Postgres Changes were removed with the anon SELECT
 *    policies (migration 015), so the device polls `station_get_orders`
 *    every 10 s and on tab focus. Security over instant realtime.
 *  Local/demo mode: the same transitions run through the store's shared
 *    domain rules (src/domain/ordering/orderOperations.ts), with the same
 *    actor tagging, so behavior matches the server (e.g. rework -> preparing).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import { isActiveOrder } from '@/domain/orderMachine';
import { stationTransitionError } from '@/domain/stations';
import { toast } from 'sonner';
import * as stationService from '@/services/stationService';
import type { Order, OrderStatus, Station, TableStatus } from '@/domain/types';

const POLL_INTERVAL_MS = 10_000;

export type KitchenEventType = 'delay' | 'remake' | 'waste' | 'note';

export interface KitchenEventInput {
  orderId: string;
  orderNumber: number;
  type: KitchenEventType;
  notes: string;
  menuItemId?: string;
  menuItemName?: string;
  quantity?: number;
}

/** @param onSessionLost called when the server rejects the station session (expired / PIN changed). */
export function useStationOrders(station: Station, onSessionLost?: () => void) {
  const remote = isSupabaseEnabled();
  const storeOrders = useStore(s => s.orders);
  const [remoteOrders, setRemoteOrders] = useState<Order[]>([]);
  const [online, setOnline] = useState(true);
  const lostRef = useRef(onSessionLost);
  lostRef.current = onSessionLost;

  const token = useCallback(() => stationService.loadStationSession(station.id)?.token ?? null, [station.id]);

  const handleError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : '';
    if (/session/i.test(message)) { stationService.clearStationSession(station.id); lostRef.current?.(); }
    return false;
  }, [station.id]);

  const refetch = useCallback(async () => {
    if (!remote) return;
    const t = token();
    if (!t) { lostRef.current?.(); return; }
    try {
      setRemoteOrders(await stationService.fetchStationOrders(t));
      setOnline(true);
    } catch (err) {
      setOnline(false);
      handleError(err);
    }
  }, [remote, token, handleError]);

  useEffect(() => {
    if (!remote) return;
    void refetch();
    const timer = setInterval(() => { void refetch(); }, POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void refetch(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [remote, refetch]);

  const orders = remote ? remoteOrders : storeOrders.filter(o => isActiveOrder(o.status));
  const actor = `station:${station.id}`;

  const transition = useCallback(async (orderId: string, next: OrderStatus, rework = false): Promise<boolean> => {
    const current = orders.find(o => o.id === orderId);
    if (!current) return false;
    if (!remote) {
      // Same permission rules the server applies to station sessions.
      const denied = stationTransitionError(station.permissions, current.status, next);
      if (denied) { toast.error(denied); return false; }
      return useStore.getState().transitionOrder(orderId, current.status, next, rework ? `${actor}:rework` : actor);
    }
    const t = token();
    if (!t) return handleError(new Error('Station session required'));
    try {
      const updated = await stationService.stationTransition(t, orderId, current.status, next);
      setRemoteOrders(prev => prev.map(o => (o.id === orderId ? updated : o)).filter(o => isActiveOrder(o.status)));
      return true;
    } catch (err) {
      void refetch();
      return handleError(err);
    }
  }, [orders, remote, actor, token, handleError, refetch, station.permissions]);

  const advanceOrder = useCallback((orderId: string, next: OrderStatus) => transition(orderId, next), [transition]);

  const adjustPrepTime = useCallback(async (orderId: string, deltaMinutes: number): Promise<boolean> => {
    if (!remote) { useStore.getState().adjustPrepTime(orderId, deltaMinutes); return true; }
    const t = token();
    if (!t) return handleError(new Error('Station session required'));
    try {
      const updated = await stationService.stationAdjustPrepTime(t, orderId, deltaMinutes);
      setRemoteOrders(prev => prev.map(o => (o.id === orderId ? updated : o)));
      return true;
    } catch (err) { return handleError(err); }
  }, [remote, token, handleError]);

  const logKitchenEvent = useCallback(async (payload: KitchenEventInput): Promise<boolean> => {
    if (!remote) { useStore.getState().logKitchenEvent({ ...payload, stationId: station.id }); return true; }
    const t = token();
    if (!t) return handleError(new Error('Station session required'));
    try { await stationService.stationLogEvent(t, payload); return true; }
    catch (err) { return handleError(err); }
  }, [remote, token, handleError, station.id]);

  /** Rework: log a remake event, then send a ready order back to preparing. */
  const remakeOrder = useCallback(async (orderId: string, notes: string): Promise<boolean> => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return false;
    const logged = await logKitchenEvent({ orderId, orderNumber: order.orderNumber, type: 'remake', notes: notes || 'Sent back for rework' });
    if (!logged) return false;
    return order.status === 'ready' ? transition(orderId, 'preparing', true) : true;
  }, [orders, logKitchenEvent, transition]);

  const setTableStatus = useCallback(async (tableId: string, status: TableStatus): Promise<boolean> => {
    if (!remote) { useStore.getState().setTableStatus(tableId, status); return true; }
    const t = token();
    if (!t) return handleError(new Error('Station session required'));
    try {
      useStore.getState().applyRemoteTable(await stationService.stationSetTableStatus(t, tableId, status));
      return true;
    } catch (err) { return handleError(err); }
  }, [remote, token, handleError]);

  return { orders, online: remote ? online : true, refetch, advanceOrder, adjustPrepTime, logKitchenEvent, remakeOrder, setTableStatus };
}
