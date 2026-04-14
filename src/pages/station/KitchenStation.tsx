import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Clock, Flame, CheckCircle2, AlertCircle, MessageSquare, Play, ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import StationLayout from '@/components/station/StationLayout';
import { useStationOrders, type KitchenEventType } from '@/lib/supabase/realtime/useStationOrders';
import { useStore } from '@/store';
import { minutesSince } from '@/lib/time';
import { advance, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { applyStationFilter, type DisplayOrder } from '@/lib/station/filterOrdersByCategory';
import type { Station, Order, OrderStatus } from '@/domain/types';

interface Props {
  station: Station;
  restaurantToken: string;
  userId: string;
  restaurantName: string;
  onLock: () => void;
}

const STATUS_BG: Record<string, string> = {
  paid:      'bg-yellow-500/8 border-yellow-500/25',
  preparing: 'bg-orange-500/8 border-orange-500/25',
  ready:     'bg-green-500/8 border-green-500/25',
};
const COLUMN_LABELS: Record<string, { label: string; color: string }> = {
  paid:      { label: 'New',         color: ORDER_STATUS_COLORS.paid },
  preparing: { label: 'In Progress', color: ORDER_STATUS_COLORS.preparing },
  ready:     { label: 'Ready',       color: ORDER_STATUS_COLORS.ready },
};
const ALL_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

// ─── ProductionSummary ────────────────────────────────────────────────────────

function ProductionSummary({ orders }: { orders: Order[] }) {
  const incoming = orders.filter(o => o.status === 'paid' || o.status === 'preparing');
  if (incoming.length === 0) return null;

  const totals = new Map<string, number>();
  for (const order of incoming) {
    for (const item of order.items) {
      totals.set(item.menuItemName, (totals.get(item.menuItemName) ?? 0) + item.quantity);
    }
  }
  if (totals.size === 0) return null;

  return (
    <div className="border-b border-yellow-500/20 bg-yellow-500/5 px-4 py-2.5 flex items-start gap-3 shrink-0">
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
        <span className="text-[11px] font-bold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide whitespace-nowrap">
          {incoming.length} active
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 min-w-0">
        {Array.from(totals.entries()).map(([name, qty]) => (
          <span key={name} className="text-xs text-foreground/75 whitespace-nowrap">
            <span className="font-bold text-foreground">{qty}×</span> {name}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── PrepTimeBar ─────────────────────────────────────────────────────────────

function PrepTimeBar({ order }: { order: Order }) {
  const elapsed = minutesSince(order.createdAt);
  const total = Math.max(1, order.estimatedPrepTime + order.prepTimeAdjustment);
  const pct = Math.min(100, (elapsed / total) * 100);
  const barColor = pct >= 90 ? '#ef4444' : pct >= 65 ? '#f97316' : '#22c55e';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{elapsed}m elapsed</span>
        <span>{total}m target</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
    </div>
  );
}

// ─── LogEventPanel ────────────────────────────────────────────────────────────

const LOG_TYPES: { value: KitchenEventType; label: string }[] = [
  { value: 'note',   label: 'Note'   },
  { value: 'delay',  label: 'Delay'  },
  { value: 'remake', label: 'Rework' },
];

function LogEventPanel({
  onLog, onClose,
}: {
  onLog: (type: KitchenEventType, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<KitchenEventType>('note');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!notes.trim()) return;
    setBusy(true);
    await onLog(type, notes.trim());
    setBusy(false);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="pt-1 space-y-2 border-t border-border/60">
        <div className="flex gap-1 pt-2">
          {LOG_TYPES.map(ev => (
            <button key={ev.value} onClick={() => setType(ev.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                type === ev.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {ev.label}
            </button>
          ))}
        </div>
        <textarea
          autoFocus rows={2}
          placeholder={type === 'remake' ? 'What needs to be redone?' : type === 'delay' ? 'Reason for delay…' : 'Add a note…'}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/20 leading-snug"
        />
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!notes.trim() || busy}
            className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 transition-all active:scale-95"
          >
            {busy ? '…' : type === 'remake' ? 'Send Back to Kitchen' : 'Log'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── KitchenOrderCard ─────────────────────────────────────────────────────────

function KitchenOrderCard({
  order, canAdvance, canCancel, canAdjustPrepTime, canReworkOrders,
  onAdvance, onCancel, onAdjustPrepTime, onLog, onRework,
  dimmedItemIds, expanded, onToggleExpanded,
}: {
  order: Order;
  canAdvance: boolean;
  canCancel: boolean;
  canAdjustPrepTime: boolean;
  canReworkOrders: boolean;
  onAdvance: () => void;
  onCancel: () => void;
  onAdjustPrepTime: (delta: number) => void;
  onLog: (type: KitchenEventType, notes: string) => Promise<void>;
  onRework: (notes: string) => Promise<void>;
  /** menuItemIds to visually de-emphasize (focus mode) */
  dimmedItemIds?: Set<string> | null;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const [logOpen, setLogOpen] = useState(false);

  const mins = minutesSince(order.createdAt);
  const totalPrepTime = order.estimatedPrepTime + order.prepTimeAdjustment;
  const isLate = mins > totalPrepTime && order.status !== 'ready';
  const nextStatus = advance(order.status as OrderStatus);
  const accent = ORDER_STATUS_COLORS[order.status as OrderStatus] ?? '#64748b';

  const itemSummary = order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ');

  return (
    <motion.div layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`rounded-2xl border overflow-hidden ${STATUS_BG[order.status] ?? 'bg-card border-border'}`}
    >
      {/* Status accent line */}
      <div className="h-0.5 w-full" style={{ backgroundColor: accent }} />

      {/* ── Collapsed header (always visible) ── */}
      <div
        className="px-4 pt-3 pb-3 flex items-center gap-2 cursor-pointer select-none"
        onClick={() => { onToggleExpanded(); setLogOpen(false); }}
      >
        <span className="font-display font-bold text-lg text-foreground shrink-0">#{order.orderNumber}</span>
        <span className="text-sm text-muted-foreground truncate flex-1">{order.tableName}</span>

        {!expanded && (
          <span className="text-xs text-muted-foreground/70 truncate hidden sm:block max-w-[140px]">
            {itemSummary}
          </span>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {isLate && <Flame className="w-3.5 h-3.5 text-destructive" />}
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <span className={`text-sm font-semibold tabular-nums ${isLate ? 'text-destructive' : 'text-muted-foreground'}`}>
            {mins}m
          </span>
        </div>

        {/* Quick action — visible even when collapsed */}
        {canAdvance && nextStatus && order.status !== 'ready' && (
          <button
            onClick={e => { e.stopPropagation(); onAdvance(); }}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl font-semibold text-xs transition-all active:scale-95 hover:opacity-90 text-white shrink-0"
            style={{ backgroundColor: accent }}
          >
            {order.status === 'paid'
              ? <><Play className="w-3 h-3" /> Start</>
              : <><CheckCircle2 className="w-3 h-3" /> Ready</>
            }
          </button>
        )}

        {order.status === 'ready' && (
          <div className="flex items-center gap-1.5 shrink-0">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">Ready</span>
          </div>
        )}

        <ChevronDown className={`w-4 h-4 text-muted-foreground/60 shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
      </div>

      {/* Compact prep bar when collapsed + preparing */}
      {!expanded && order.status === 'preparing' && (
        <div className="px-4 pb-3">
          <PrepTimeBar order={order} />
        </div>
      )}

      {/* ── Expanded content ── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expanded"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 flex flex-col gap-3 border-t border-border/40 pt-3">
              {/* Notes */}
              {order.notes && (
                <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <span className="text-xs text-amber-800 dark:text-amber-300 font-medium leading-snug">{order.notes}</span>
                </div>
              )}

              {/* Items */}
              <ul className="space-y-2">
                {order.items.map((item, i) => {
                  const isDimmed = dimmedItemIds?.has(item.menuItemId) ?? false;
                  return (
                    <li key={i} className={`flex items-start gap-2 transition-opacity ${isDimmed ? 'opacity-35' : ''}`}>
                      <span className="font-bold text-foreground text-base w-6 shrink-0 tabular-nums">{item.quantity}×</span>
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-foreground leading-tight">{item.menuItemName}</span>
                        {item.modifiers.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {item.modifiers.map((m, j) => (
                              <li key={j} className="text-xs text-muted-foreground pl-2 border-l-2 border-border/60 flex gap-1">
                                <span className="font-medium text-foreground/60">{m.modifierName}:</span>
                                <span>{m.optionName}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* Prep time adjuster */}
              {canAdjustPrepTime && order.status !== 'ready' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground flex-1 leading-none">
                    Target: <span className="font-semibold text-foreground">{totalPrepTime}m</span>
                    {order.prepTimeAdjustment !== 0 && (
                      <span className={`ml-1 font-medium ${order.prepTimeAdjustment > 0 ? 'text-orange-500' : 'text-green-500'}`}>
                        ({order.prepTimeAdjustment > 0 ? '+' : ''}{order.prepTimeAdjustment}m)
                      </span>
                    )}
                  </span>
                  <button onClick={() => onAdjustPrepTime(-5)}
                    className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95"
                  >−</button>
                  <button onClick={() => onAdjustPrepTime(+5)}
                    className="w-7 h-7 rounded-lg border border-border flex items-center justify-center text-sm font-bold text-muted-foreground hover:bg-muted hover:text-foreground transition-all active:scale-95"
                  >+</button>
                </div>
              )}

              {/* Progress bar — preparing only */}
              {order.status === 'preparing' && <PrepTimeBar order={order} />}

              {/* Log event panel */}
              <AnimatePresence>
                {logOpen && (
                  <LogEventPanel
                    onLog={async (type, notes) => {
                      if (type === 'remake') await onRework(notes);
                      else await onLog(type, notes);
                    }}
                    onClose={() => setLogOpen(false)}
                  />
                )}
              </AnimatePresence>

              {/* Expanded actions */}
              {order.status === 'ready' ? (
                <div className="flex items-center gap-2 py-0.5">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-sm font-medium text-green-600 dark:text-green-400 flex-1">Ready to serve</span>
                  {canReworkOrders && !logOpen && (
                    <button onClick={() => setLogOpen(true)}
                      className="px-3 py-1.5 rounded-xl border border-border text-xs text-muted-foreground hover:bg-muted transition-all"
                    >
                      Rework
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  {canAdvance && nextStatus && (
                    <button
                      onClick={onAdvance}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition-all active:scale-95 hover:opacity-90 text-white"
                      style={{ backgroundColor: accent }}
                    >
                      {order.status === 'paid'
                        ? <><Play className="w-4 h-4" /> Start Cooking</>
                        : <><CheckCircle2 className="w-4 h-4" /> {ORDER_STATUS_LABELS[nextStatus]}</>
                      }
                    </button>
                  )}
                  {order.status === 'preparing' && !logOpen && (
                    <button onClick={() => setLogOpen(v => !v)}
                      className="px-3 py-3 rounded-xl border border-border text-muted-foreground hover:bg-muted transition-all active:scale-95"
                      title="Log event"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  )}
                  {canCancel && (
                    <button onClick={onCancel}
                      className="px-3 py-3 rounded-xl border border-destructive/30 text-destructive hover:bg-destructive/10 transition-all active:scale-95"
                      title="Cancel order"
                    >
                      <span className="text-sm font-medium">✕</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── KitchenStation ───────────────────────────────────────────────────────────

export default function KitchenStation({ station, restaurantToken, userId, restaurantName, onLock }: Props) {
  const { orders, online, advanceOrder, adjustPrepTime, logKitchenEvent, remakeOrder } = useStationOrders(restaurantToken, userId);
  const menuItems = useStore(s => s.menuItems);
  const [advancing, setAdvancing] = useState<Set<string>>(new Set());
  const [mobileTab, setMobileTab] = useState<OrderStatus>('paid');

  // Station is always normalized by StationGate before reaching here
  const canAdjustPrepTime = station.permissions.canAdjustPrepTime;
  const canReworkOrders   = station.permissions.canReworkOrders;
  const showSummary       = station.permissions.showProductionSummary;
  const { filterCategories, categoryMode } = station.permissions;

  const visibleStatuses = station.permissions.visibleStatuses.length > 0
    ? ALL_STATUSES.filter(s => station.permissions.visibleStatuses.includes(s))
    : ALL_STATUSES;

  // Unified category filtering: respects mode (all / focus / exclusive)
  const displayOrders: DisplayOrder[] = applyStationFilter(
    orders.filter(o => visibleStatuses.includes(o.status as OrderStatus)),
    menuItems,
    filterCategories,
    categoryMode,
  );

  // ── Expansion state — lifted to component level so cards don't auto-collapse
  // when an order moves columns (paid → preparing). New 'paid' orders start expanded.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set);

  useEffect(() => {
    setExpandedIds(prev => {
      const newPaid = orders.filter(o => o.status === 'paid' && !prev.has(o.id));
      if (!newPaid.length) return prev;
      const next = new Set(prev);
      newPaid.forEach(o => next.add(o.id));
      return next;
    });
  }, [orders]);

  function toggleExpanded(orderId: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }

  // Sort by urgency: late orders first, then oldest-first within same urgency
  function sortByUrgency(entries: DisplayOrder[]): DisplayOrder[] {
    return [...entries].sort((a, b) => {
      const aElapsed = minutesSince(a.order.createdAt);
      const bElapsed = minutesSince(b.order.createdAt);
      const aLate = aElapsed > a.order.estimatedPrepTime + a.order.prepTimeAdjustment ? 1 : 0;
      const bLate = bElapsed > b.order.estimatedPrepTime + b.order.prepTimeAdjustment ? 1 : 0;
      return bLate - aLate || aElapsed - bElapsed;
    });
  }

  async function handleAdvance(order: Order) {
    const next = advance(order.status as OrderStatus);
    if (!next) return;
    setAdvancing(s => new Set(s).add(order.id));
    const ok = await advanceOrder(order.id, next);
    setAdvancing(s => { const n = new Set(s); n.delete(order.id); return n; });
    if (!ok) toast.error('Failed to update order');
  }

  async function handleCancel(order: Order) {
    setAdvancing(s => new Set(s).add(order.id));
    const ok = await advanceOrder(order.id, 'cancelled');
    setAdvancing(s => { const n = new Set(s); n.delete(order.id); return n; });
    if (!ok) toast.error('Failed to cancel order');
  }

  async function handleAdjustPrepTime(order: Order, delta: number) {
    const ok = await adjustPrepTime(order.id, delta);
    if (!ok) toast.error('Failed to adjust time');
  }

  async function handleLog(order: Order, type: KitchenEventType, notes: string) {
    const ok = await logKitchenEvent({ orderId: order.id, orderNumber: order.orderNumber, type, notes });
    if (ok) toast.success('Event logged');
    else toast.error('Failed to log event');
  }

  async function handleRework(order: Order, notes: string) {
    const ok = await remakeOrder(order.id, notes);
    if (ok) toast.success('Sent back to kitchen');
    else toast.error('Failed to rework order');
  }

  function renderCard(d: DisplayOrder) {
    const { order } = d;
    // Items in `context` are shown dimmed — they're relevant to the full order
    // but outside this station's focus categories.
    const dimmedItemIds = d.context.length > 0
      ? new Set(d.context.map(i => i.menuItemId))
      : null;
    return (
      <KitchenOrderCard
        key={order.id}
        order={order}
        canAdvance={station.permissions.canAdvanceOrders && !advancing.has(order.id)}
        canCancel={station.permissions.canCancelOrders && !advancing.has(order.id)}
        canAdjustPrepTime={canAdjustPrepTime && !advancing.has(order.id)}
        canReworkOrders={canReworkOrders && !advancing.has(order.id)}
        onAdvance={() => handleAdvance(order)}
        onCancel={() => handleCancel(order)}
        onAdjustPrepTime={delta => handleAdjustPrepTime(order, delta)}
        onLog={(type, notes) => handleLog(order, type, notes)}
        onRework={notes => handleRework(order, notes)}
        dimmedItemIds={dimmedItemIds}
        expanded={expandedIds.has(order.id)}
        onToggleExpanded={() => toggleExpanded(order.id)}
      />
    );
  }

  function renderColumn(status: OrderStatus) {
    const col = sortByUrgency(displayOrders.filter(d => d.order.status === status));
    const meta = COLUMN_LABELS[status];
    return (
      <div key={status} className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="hidden md:flex px-4 py-3 border-b border-border items-center gap-2 shrink-0">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
          <span className="font-semibold text-sm text-foreground">{meta.label}</span>
          {col.length > 0 && (
            <span className="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center ml-auto shrink-0"
              style={{ backgroundColor: meta.color + '22', color: meta.color }}
            >{col.length}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <AnimatePresence mode="popLayout">
            {col.length === 0 ? (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-center py-12 text-muted-foreground text-sm"
              >—</motion.p>
            ) : col.map(renderCard)}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  const activeTab = visibleStatuses.includes(mobileTab) ? mobileTab : visibleStatuses[0];

  return (
    <StationLayout station={station} restaurantName={restaurantName} onLock={onLock} online={online}>
      <div className="absolute inset-0 flex flex-col">
        {/* Production summary */}
        {showSummary && <ProductionSummary orders={displayOrders.map(d => d.order)} />}

        {/* ── Mobile ── */}
        <div className="flex flex-col md:hidden flex-1 min-h-0 overflow-hidden">
          <div className="flex border-b border-border shrink-0">
            {visibleStatuses.map(status => {
              const count = displayOrders.filter(d => d.order.status === status).length;
              const meta = COLUMN_LABELS[status];
              const active = status === activeTab;
              return (
                <button key={status} onClick={() => setMobileTab(status)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                  {meta.label}
                  {count > 0 && (
                    <span className="text-[10px] font-bold w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: meta.color + '22', color: meta.color }}
                    >{count}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {(() => {
              const tabOrders = sortByUrgency(displayOrders.filter(d => d.order.status === activeTab));
              return (
                <AnimatePresence mode="popLayout">
                  {tabOrders.length === 0 ? (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                      className="text-center py-16 text-muted-foreground text-sm"
                    >—</motion.p>
                  ) : tabOrders.map(renderCard)}
                </AnimatePresence>
              );
            })()}
          </div>
        </div>

        {/* ── Desktop: 3-column kanban ── */}
        <div className="hidden md:flex flex-1 divide-x divide-border overflow-hidden min-h-0">
          {visibleStatuses.map(renderColumn)}
        </div>
      </div>
    </StationLayout>
  );
}
