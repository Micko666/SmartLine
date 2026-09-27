/** Applies authoritative rows from realtime/refresh. The only entry point for remote data. */
import { mergeOrders } from '../../domain/ordering/orderMerge';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createRemoteSlice = (set: StoreSet, _get: StoreGet): Pick<AppState, 'applyRemoteOrder' | 'mergeRemoteOrders' | 'applyRemoteKitchenEvent' | 'applyRemoteCalendarEvent' | 'applyRemoteMenuItem' | 'applyRemoteTable'> => ({
  applyRemoteOrder(order) {
    set(s => ({ orders: s.orders.some(o => o.id === order.id)
      ? s.orders.map(o => o.id === order.id ? order : o) : [order, ...s.orders] }));
  },
  mergeRemoteOrders(orders) {
    set(s => ({ orders: mergeOrders(s.orders, orders) }));
  },
  applyRemoteKitchenEvent(event) {
    set(s => (s.kitchenEvents.some(e => e.id === event.id) ? s : { kitchenEvents: [event, ...s.kitchenEvents].slice(0, 500) }));
  },
  applyRemoteCalendarEvent(event) {
    set(s => ({ calendarEvents: s.calendarEvents.some(e => e.id === event.id)
      ? s.calendarEvents.map(e => e.id === event.id ? event : e) : [event, ...s.calendarEvents] }));
  },
  applyRemoteMenuItem(item) {
    set(s => ({ menuItems: s.menuItems.some(m => m.id === item.id)
      ? s.menuItems.map(m => m.id === item.id ? item : m) : [...s.menuItems, item] }));
  },
  applyRemoteTable(table) {
    set(s => ({ tables: s.tables.some(t => t.id === table.id)
      ? s.tables.map(t => t.id === table.id ? table : t) : [...s.tables, table] }));
  },
});
