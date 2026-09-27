import { useState, useMemo } from 'react';
import { Clock, ArrowRight, X, AlertTriangle, ChevronDown, ChevronUp, History, CalendarClock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { restaurantDate, restaurantDayKey } from '@/domain/time/restaurantTime';
import { useShallow } from 'zustand/react/shallow';
import { advance, canTransition, ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';
import { minutesSince } from '@/lib/time';
import type { OrderStatus, Order } from '@/domain/types';
import { toast } from 'sonner';
import { TABS, ACTIVE_STATUSES, timeAgo, formatScheduledFor, formatTime, formatDayLabel } from './orders/shared';
import OrderCustomerInfo from './orders/OrderCustomerInfo';
import TableOrderGroup from './orders/TableOrderGroup';
import KitchenEventModal from './orders/KitchenEventModal';

export default function Orders() {
  const { orders, advanceOrderStatus, cancelOrder, logKitchenEvent, settings, tables, setTableStatus } = useStore(useShallow(s => ({
    orders:             s.orders,
    advanceOrderStatus: s.advanceOrderStatus,
    cancelOrder:        s.cancelOrder,
    logKitchenEvent:    s.logKitchenEvent,
    settings:           s.settings,
    tables:             s.tables,
    setTableStatus:     s.setTableStatus,
  })));

  const [filter,      setFilter]      = useState<OrderStatus | 'all' | 'tables'>('all');
  const [eventOrder,  setEventOrder]  = useState<Order | null>(null);
  const [openDays,    setOpenDays]    = useState<Record<string, boolean>>({});
  const sym = settings.currencySymbol;

  const filtered = filter === 'all' ? orders
    : filter === 'tables' ? orders.filter(o => ACTIVE_STATUSES.includes(o.status as OrderStatus))
    : orders.filter(o => o.status === filter);

  // Split visible orders into three buckets:
  //   1. carryoverActive  — from previous days, still in an active status (paid/preparing/ready)
  //                         → pinned at the very top until they reach a terminal state
  //   2. todayOrders      — today's orders
  //   3. olderByDay       — previous-day orders that are already in a terminal state (accordion)
  const { carryoverActive, todayOrders, olderByDay, olderDayKeys } = useMemo(() => {
    const now = new Date();
    const today = restaurantDate(settings.timezone, now);
    const carryoverActive: Order[] = [];
    const todayOrders: Order[] = [];
    const older: Record<string, Order[]> = {};
    for (const o of filtered) {
      const k = restaurantDayKey(o.createdAt, settings.timezone);
      if (k === today) {
        todayOrders.push(o);
      } else if (ACTIVE_STATUSES.includes(o.status as OrderStatus)) {
        carryoverActive.push(o);
      } else {
        (older[k] = older[k] ?? []).push(o);
      }
    }
    // Oldest carryover first so urgent items surface quickly
    carryoverActive.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return {
      carryoverActive,
      todayOrders,
      olderByDay: older,
      olderDayKeys: Object.keys(older).sort((a, b) => b.localeCompare(a)),
    };
  }, [filtered, settings.timezone]);

  const toggleDay = (k: string) => setOpenDays(prev => ({ ...prev, [k]: !prev[k] }));

  // Build table groups for the "Tables" view
  const tableGroups = (() => {
    const active = orders.filter(o => ACTIVE_STATUSES.includes(o.status as OrderStatus));
    const byTable: Record<string, Order[]> = {};
    for (const o of active) {
      const key = o.tableId || 'walk-in';
      (byTable[key] = byTable[key] ?? []).push(o);
    }
    return Object.entries(byTable)
      .map(([tableId, tableOrders]) => ({
        tableId,
        tableName: tableOrders[0].tableName,
        table: tables.find(t => t.id === tableId) ?? null,
        orders: [...tableOrders].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
        hasReady: tableOrders.some(o => o.status === 'ready'),
        hasLate: tableOrders.some(o =>
          minutesSince(o.createdAt) > (o.estimatedPrepTime + o.prepTimeAdjustment) && o.status !== 'ready',
        ),
      }))
      .sort((a, b) => (b.hasReady ? 1 : 0) - (a.hasReady ? 1 : 0));
  })();

  const counts = TABS.reduce((acc, t) => {
    if (t.value === 'all') acc[t.value] = orders.length;
    else if (t.value === 'tables') acc[t.value] = tableGroups.length;
    else acc[t.value] = orders.filter(o => o.status === t.value).length;
    return acc;
  }, {} as Record<string, number>);

  const handleAdvance = (orderId: string, orderNumber: number, currentStatus: OrderStatus) => {
    const next = advance(currentStatus);
    if (!next) return;
    // Toast only after the server (or local rules) accepted the transition.
    void advanceOrderStatus(orderId).then(ok => { if (ok) toast.success(`#${orderNumber} → ${ORDER_STATUS_LABELS[next]}`); });
  };

  const handleCancel = (orderId: string, orderNumber: number) => {
    void cancelOrder(orderId).then(ok => { if (ok) toast.success(`#${orderNumber} cancelled — stock restored`); });
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-2xl font-bold">Orders</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Manage incoming orders and kitchen flow</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TABS.map(t => (
            <button
              key={t.value} onClick={() => setFilter(t.value)}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${filter === t.value ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {t.label}
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${filter === t.value ? 'bg-primary-foreground/20' : 'bg-background'}`}>{counts[t.value]}</span>
            </button>
          ))}
        </div>

        {/* Tables view */}
        {filter === 'tables' && (
          tableGroups.length === 0 ? (
            <div className="glass-card p-12 text-center">
              <p className="text-muted-foreground">No active tables right now.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {tableGroups.map(({ tableId, tableName, table, orders: tOrders, hasReady, hasLate }) => (
                  <TableOrderGroup
                    key={tableId}
                    table={table}
                    tableName={tableName}
                    orders={tOrders}
                    sym={sym}
                    hasReady={hasReady}
                    hasLate={hasLate}
                    onAdvance={(orderId, orderNumber, status) => handleAdvance(orderId, orderNumber, status)}
                    onCancel={(orderId, orderNumber) => handleCancel(orderId, orderNumber)}
                    onLogEvent={order => setEventOrder(order)}
                    onClearTable={() => {
                      setTableStatus(tableId, 'available');
                      toast.success(`${tableName} cleared`);
                    }}
                    canClear={tOrders.every(o => o.status === 'completed' || o.status === 'cancelled')}
                  />
                ))}
              </AnimatePresence>
            </div>
          )
        )}

        {/* Orders grid (all other tabs) */}
        {filter !== 'tables' && (filtered.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-muted-foreground">No orders{filter !== 'all' ? ` in "${ORDER_STATUS_LABELS[filter as OrderStatus]}"` : ''} yet.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ── Carryover active orders (previous days, not yet terminal) ── */}
            {carryoverActive.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                  <h2 className="font-display font-semibold text-sm text-warning uppercase tracking-wide">
                    Needs attention
                  </h2>
                  <span className="text-xs text-warning/70 normal-case">
                    · {carryoverActive.length} order{carryoverActive.length === 1 ? '' : 's'} from previous days still active
                  </span>
                </div>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <AnimatePresence mode="popLayout">
                    {carryoverActive.map(order => {
                      const nextStatus = advance(order.status);
                      const canCancel = canTransition(order.status, 'cancelled');
                      const finalPrepTime = order.estimatedPrepTime + order.prepTimeAdjustment;
                      return (
                        <motion.div
                          key={order.id} layout
                          initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                          className="glass-card p-5 border-warning/40 relative overflow-hidden"
                        >
                          {/* Amber left accent bar */}
                          <div className="absolute left-0 top-0 bottom-0 w-1 bg-warning rounded-l-2xl" />
                          <div className="pl-1">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-display text-lg font-bold shrink-0">#{order.orderNumber}</span>
                                <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                              </div>
                              <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <span className="text-xs text-warning font-medium">
                                  {new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">{formatTime(order.createdAt)}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                              <span className="font-medium text-foreground">{order.tableName}</span>
                              <span>·</span>
                              <span className="capitalize">{order.paymentMethod.replace('_', ' ')}</span>
                            </div>
                            {order.scheduledFor && (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-lg mb-3 w-fit">
                                <CalendarClock className="w-3 h-3 shrink-0" />
                                {formatScheduledFor(order.scheduledFor, settings.timezone)}
                              </div>
                            )}

                            <div className="space-y-1.5 mb-4">
                              {order.items.map((item, i) => (
                                <div key={i} className="flex items-center justify-between text-sm">
                                  <span className="truncate">{item.menuItemIcon} {item.quantity}× {item.menuItemName}</span>
                                  <span className="text-muted-foreground shrink-0 ml-2">{sym}{item.lineTotal.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>

                            <OrderCustomerInfo order={order} />
                            {order.notes && (
                              <p className="text-xs text-muted-foreground mb-3 p-2 bg-muted/50 rounded-lg italic">"{order.notes}"</p>
                            )}

                            <div className="flex items-center justify-between pt-3 border-t border-border">
                              <div>
                                <p className="text-sm font-bold">{sym}{order.total.toFixed(2)}</p>
                                <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> ~{finalPrepTime} min
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                {(order.status === 'preparing' || order.status === 'paid') && (
                                  <button
                                    onClick={() => setEventOrder(order)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-warning/40 text-warning text-xs font-medium hover:bg-warning/10 transition-colors"
                                    title="Log kitchen event"
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                  </button>
                                )}
                                {canCancel && (
                                  <button
                                    onClick={() => handleCancel(order.id, order.orderNumber)}
                                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/10 transition-colors"
                                  >
                                    <X className="w-3 h-3" /> Cancel
                                  </button>
                                )}
                                {nextStatus && nextStatus !== 'cancelled' && (
                                  <button
                                    onClick={() => handleAdvance(order.id, order.orderNumber, order.status)}
                                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                                  >
                                    {ORDER_STATUS_LABELS[nextStatus]} <ArrowRight className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {todayOrders.length > 0 && (
              <div>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="font-display font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Today <span className="text-foreground/70 normal-case">· {todayOrders.length} order{todayOrders.length === 1 ? '' : 's'}</span>
                  </h2>
                </div>
                <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <AnimatePresence mode="popLayout">
                    {todayOrders.map(order => {
                const nextStatus = advance(order.status);
                const canCancel = canTransition(order.status, 'cancelled');
                const finalPrepTime = order.estimatedPrepTime + order.prepTimeAdjustment;

                return (
                  <motion.div
                    key={order.id} layout
                    initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                    className={`glass-card p-5 ${order.status === 'cancelled' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-display text-lg font-bold shrink-0">#{order.orderNumber}</span>
                        <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums" title={new Date(order.createdAt).toLocaleString()}>
                        {formatTime(order.createdAt)} · {timeAgo(order.createdAt)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <span className="font-medium text-foreground">{order.tableName}</span>
                      <span>·</span>
                      <span className="capitalize">{order.paymentMethod.replace('_', ' ')}</span>
                    </div>
                    {order.scheduledFor && (
                      <div className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2.5 py-1 rounded-lg mb-3 w-fit">
                        <CalendarClock className="w-3 h-3 shrink-0" />
                        {formatScheduledFor(order.scheduledFor, settings.timezone)}
                      </div>
                    )}

                    <div className="space-y-1.5 mb-4">
                      {order.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="truncate">{item.menuItemIcon} {item.quantity}× {item.menuItemName}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">{sym}{item.lineTotal.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

                    <OrderCustomerInfo order={order} />
                    {order.notes && (
                      <p className="text-xs text-muted-foreground mb-3 p-2 bg-muted/50 rounded-lg italic">"{order.notes}"</p>
                    )}

                    <div className="flex items-center justify-between pt-3 border-t border-border">
                      <div>
                        <p className="text-sm font-bold">{sym}{order.total.toFixed(2)}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> ~{finalPrepTime} min
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {(order.status === 'preparing' || order.status === 'paid') && (
                          <button
                            onClick={() => setEventOrder(order)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-warning/40 text-warning text-xs font-medium hover:bg-warning/10 transition-colors"
                            title="Log kitchen event"
                          >
                            <AlertTriangle className="w-3 h-3" />
                          </button>
                        )}
                        {canCancel && (
                          <button
                            onClick={() => handleCancel(order.id, order.orderNumber)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-destructive/30 text-destructive text-xs font-medium hover:bg-destructive/10 transition-colors"
                          >
                            <X className="w-3 h-3" /> Cancel
                          </button>
                        )}
                        {nextStatus && nextStatus !== 'cancelled' && (
                          <button
                            onClick={() => handleAdvance(order.id, order.orderNumber, order.status)}
                            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                          >
                            {ORDER_STATUS_LABELS[nextStatus]} <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {olderDayKeys.length > 0 && (
              <div>
                <div className="flex items-baseline gap-2 mb-3">
                  <History className="w-3.5 h-3.5 text-muted-foreground" />
                  <h2 className="font-display font-semibold text-sm text-muted-foreground uppercase tracking-wide">Previous days</h2>
                  <span className="text-xs text-muted-foreground normal-case">· {olderDayKeys.length} day{olderDayKeys.length === 1 ? '' : 's'}</span>
                </div>
                <div className="glass-card overflow-hidden">
                  {olderDayKeys.map(k => {
                    const dayOrders = olderByDay[k];
                    const dayTotal = dayOrders.reduce((sum, o) => sum + o.total, 0);
                    const open = openDays[k] ?? false;
                    return (
                      <div key={k} className="border-b border-border last:border-b-0">
                        <button
                          onClick={() => toggleDay(k)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
                        >
                          <span className="font-semibold text-sm">{formatDayLabel(k, settings.timezone)}</span>
                          <span className="text-xs text-muted-foreground">{dayOrders.length} order{dayOrders.length === 1 ? '' : 's'}</span>
                          <span className="text-xs font-semibold text-foreground ml-auto tabular-nums">{sym}{dayTotal.toFixed(2)}</span>
                          {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </button>
                        {open && (
                          <div className="border-t border-border divide-y divide-border bg-muted/10">
                            {dayOrders.map(o => {
                              const itemCount = o.items.reduce((n, it) => n + it.quantity, 0);
                              return (
                                <div key={o.id} className="flex items-center gap-2.5 px-4 py-2 text-xs hover:bg-muted/30 transition-colors">
                                  <span className="font-mono text-muted-foreground tabular-nums w-12 shrink-0" title={new Date(o.createdAt).toLocaleString()}>{formatTime(o.createdAt)}</span>
                                  <span className="font-bold w-14 shrink-0">#{o.orderNumber}</span>
                                  <span className={`${ORDER_STATUS_CSS[o.status]} text-[10px] shrink-0`}>{ORDER_STATUS_LABELS[o.status]}</span>
                                  <span className="text-muted-foreground truncate flex-1 min-w-0">
                                    {o.tableName} · {itemCount} item{itemCount === 1 ? '' : 's'}
                                  </span>
                                  <span className="font-semibold tabular-nums text-foreground shrink-0">{sym}{o.total.toFixed(2)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        ))}
      </div>

      <AnimatePresence>
        {eventOrder && (
          <KitchenEventModal
            order={eventOrder}
            sym={settings.currencySymbol}
            onSave={(type, notes, menuItemId, menuItemName, quantity, estimatedCost) => {
              logKitchenEvent({
                orderId: eventOrder.id,
                orderNumber: eventOrder.orderNumber,
                type,
                notes,
                menuItemId,
                menuItemName,
                quantity,
                estimatedCost,
              });
              toast.success(`Event logged for #${eventOrder.orderNumber}`);
              setEventOrder(null);
            }}
            onClose={() => setEventOrder(null)}
          />
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
