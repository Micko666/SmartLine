import { useState, useMemo } from 'react';
import { CheckCircle2, Clock, ChefHat, CreditCard, ArrowRight, X, RotateCcw, AlertTriangle, Table2, Flame, ChevronDown, ChevronUp, History } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { advance, canTransition, ORDER_STATUS_CSS, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { minutesSince } from '@/lib/time';
import type { OrderStatus, Order, KitchenEventType, Table, TableStatus } from '@/domain/types';
import { TABLE_STATUS_COLOR, TABLE_STATUS_LABEL } from '@/domain/tables';
import { toast } from 'sonner';

const STATUS_ICONS: Record<OrderStatus, React.ElementType> = {
  paid: CreditCard,
  preparing: ChefHat,
  ready: Clock,
  completed: CheckCircle2,
  cancelled: X,
  refunded: RotateCcw,
};

const TABS: { label: string; value: OrderStatus | 'all' | 'tables' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Paid', value: 'paid' },
  { label: 'Preparing', value: 'preparing' },
  { label: 'Ready', value: 'ready' },
  { label: 'Completed', value: 'completed' },
  { label: 'Tables', value: 'tables' },
];

const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : `${m}m ago`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(key: string) {
  const now = new Date();
  const todayK = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  const yestK = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
  if (key === todayK) return 'Today';
  if (key === yestK) return 'Yesterday';
  return new Date(key + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

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
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const carryoverActive: Order[] = [];
    const todayOrders: Order[] = [];
    const older: Record<string, Order[]> = {};
    for (const o of filtered) {
      const k = dayKey(o.createdAt);
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
  }, [filtered]);

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
    advanceOrderStatus(orderId);
    toast.success(`#${orderNumber} → ${ORDER_STATUS_LABELS[next]}`);
  };

  const handleCancel = (orderId: string, orderNumber: number) => {
    cancelOrder(orderId);
    toast.success(`#${orderNumber} cancelled — stock restored`);
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

                            <div className="space-y-1.5 mb-4">
                              {order.items.map((item, i) => (
                                <div key={i} className="flex items-center justify-between text-sm">
                                  <span className="truncate">{item.menuItemIcon} {item.quantity}× {item.menuItemName}</span>
                                  <span className="text-muted-foreground shrink-0 ml-2">{sym}{item.lineTotal.toFixed(2)}</span>
                                </div>
                              ))}
                            </div>

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
                const StatusIcon = STATUS_ICONS[order.status];
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

                    <div className="space-y-1.5 mb-4">
                      {order.items.map((item, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <span className="truncate">{item.menuItemIcon} {item.quantity}× {item.menuItemName}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">{sym}{item.lineTotal.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>

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
                          <span className="font-semibold text-sm">{formatDayLabel(k)}</span>
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

// ─── TableOrderGroup ─────────────────────────────────────────────────────────

function TableOrderGroup({
  table, tableName, orders, sym, hasReady, hasLate,
  onAdvance, onCancel, onLogEvent, onClearTable, canClear,
}: {
  table: Table | null;
  tableName: string;
  orders: Order[];
  sym: string;
  hasReady: boolean;
  hasLate: boolean;
  onAdvance: (orderId: string, orderNumber: number, status: OrderStatus) => void;
  onCancel: (orderId: string, orderNumber: number) => void;
  onLogEvent: (order: Order) => void;
  onClearTable: () => void;
  canClear: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      className={`glass-card overflow-hidden ${hasReady ? 'border-green-500/30' : 'border-border'}`}
    >
      {hasReady && <div className="h-0.5 bg-green-500" />}

      {/* Table header */}
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-border ${hasReady ? 'bg-green-500/5' : 'bg-muted/30'}`}>
        <Table2 className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-foreground">{tableName}</span>
            {table?.zone && (
              <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">{table.zone}</span>
            )}
            {table && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: TABLE_STATUS_COLOR[table.status as TableStatus] + '20',
                  color: TABLE_STATUS_COLOR[table.status as TableStatus],
                }}
              >
                {TABLE_STATUS_LABEL[table.status as TableStatus]}
              </span>
            )}
            {hasLate && <Flame className="w-3.5 h-3.5 text-destructive shrink-0" title="Late order" />}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">{orders.length} order{orders.length !== 1 ? 's' : ''}</span>
          {table && canClear && (
            <button
              onClick={onClearTable}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <CheckCircle2 className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Orders */}
      <div className="divide-y divide-border">
        {orders.map(order => {
          const nextStatus = advance(order.status);
          const canCanc = canTransition(order.status, 'cancelled');
          const mins = minutesSince(order.createdAt);
          const isReady = order.status === 'ready';
          const accentColor = ORDER_STATUS_COLORS[order.status as OrderStatus] ?? '#64748b';

          return (
            <div key={order.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-semibold text-xs text-foreground">#{order.orderNumber}</span>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: accentColor + '20', color: accentColor }}
                  >
                    {ORDER_STATUS_LABELS[order.status as OrderStatus]}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto tabular-nums flex items-center gap-0.5" title={new Date(order.createdAt).toLocaleString()}>
                    <Clock className="w-2.5 h-2.5" />{formatTime(order.createdAt)} · {mins}m
                  </span>
                </div>
                <p className="text-xs text-foreground/70 truncate">
                  {order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ')}
                </p>
                {order.notes && (
                  <p className="text-[10px] text-muted-foreground italic mt-0.5 truncate">"{order.notes}"</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-bold text-foreground">{sym}{order.total.toFixed(2)}</span>
                {(order.status === 'preparing' || order.status === 'paid') && (
                  <button
                    onClick={() => onLogEvent(order)}
                    className="w-7 h-7 rounded-lg border border-warning/40 text-warning text-xs flex items-center justify-center hover:bg-warning/10 transition-colors"
                    title="Log kitchen event"
                  >
                    <AlertTriangle className="w-3 h-3" />
                  </button>
                )}
                {canCanc && (
                  <button
                    onClick={() => onCancel(order.id, order.orderNumber)}
                    className="w-7 h-7 rounded-lg border border-destructive/30 text-destructive text-xs flex items-center justify-center hover:bg-destructive/10 transition-colors"
                    title="Cancel order"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {nextStatus && nextStatus !== 'cancelled' && (
                  <button
                    onClick={() => onAdvance(order.id, order.orderNumber, order.status)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                      isReady
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-primary text-primary-foreground hover:opacity-90'
                    }`}
                  >
                    {isReady ? 'Deliver' : ORDER_STATUS_LABELS[nextStatus]}
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ─── Kitchen Event Modal ──────────────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<KitchenEventType, { label: string; desc: string; color: string }> = {
  waste:  { label: 'Waste',  desc: 'Food discarded or spoiled',      color: 'border-destructive/50 bg-destructive/5 text-destructive' },
  remake: { label: 'Remake', desc: 'Item needs to be prepared again', color: 'border-warning/50 bg-warning/5 text-warning' },
  delay:  { label: 'Delay',  desc: 'Preparation taking longer',       color: 'border-info/50 bg-info/5 text-info' },
  note:   { label: 'Note',   desc: 'General kitchen observation',      color: 'border-border bg-muted/30 text-foreground' },
};

function KitchenEventModal({ order, sym, onSave, onClose }: {
  order: Order;
  sym: string;
  onSave: (
    type: KitchenEventType,
    notes: string,
    menuItemId?: string,
    menuItemName?: string,
    quantity?: number,
    estimatedCost?: number,
  ) => void;
  onClose: () => void;
}) {
  const [type,          setType]          = useState<KitchenEventType>('waste');
  const [notes,         setNotes]         = useState('');
  const [selectedItem,  setSelectedItem]  = useState('');
  const [quantity,      setQuantity]      = useState<number | undefined>(undefined);
  const [estimatedCost, setEstimatedCost] = useState<number | undefined>(undefined);

  const selectedOrderItem = order.items.find(i => i.menuItemId === selectedItem);

  const handleSave = () => {
    if (!notes.trim() && type !== 'note') {
      return; // silently require notes for non-notes
    }
    onSave(
      type,
      notes.trim() || `${EVENT_TYPE_CONFIG[type].label} logged`,
      selectedItem || undefined,
      selectedOrderItem?.menuItemName,
      quantity,
      estimatedCost,
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28 }} onClick={e => e.stopPropagation()}
        className="glass-card-solid w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-base font-bold">Log Kitchen Event</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Order #{order.orderNumber} · {order.tableName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        {/* Event type */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(Object.entries(EVENT_TYPE_CONFIG) as [KitchenEventType, typeof EVENT_TYPE_CONFIG[KitchenEventType]][]).map(([key, cfg]) => (
            <button
              key={key} onClick={() => setType(key)}
              className={`p-3 rounded-xl border text-left transition-colors ${type === key ? cfg.color + ' border-current' : 'border-border bg-muted/20 hover:bg-muted/40'}`}
            >
              <p className="text-sm font-semibold">{cfg.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{cfg.desc}</p>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* Which item */}
          <div>
            <label className="text-xs font-medium mb-1 block">Item (optional)</label>
            <select
              value={selectedItem} onChange={e => setSelectedItem(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none"
            >
              <option value="">All / general</option>
              {order.items.map(i => (
                <option key={i.menuItemId} value={i.menuItemId}>{i.menuItemName}</option>
              ))}
            </select>
          </div>

          {/* Quantity + estimated cost */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Quantity</label>
              <input
                type="number" min="1" value={quantity ?? ''}
                onChange={e => setQuantity(e.target.value === '' ? undefined : parseInt(e.target.value) || 1)}
                placeholder="—"
                className="w-full h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Est. Cost ({sym})</label>
              <input
                type="number" step="0.01" min="0" value={estimatedCost ?? ''}
                onChange={e => setEstimatedCost(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="—"
                className="w-full h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium mb-1 block">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="What happened? Be specific for better analytics."
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            Log Event
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
