import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import StationLayout from '@/components/station/StationLayout';
import { useStationOrders, type KitchenEventType } from '@/lib/supabase/realtime/useStationOrders';
import { useStore } from '@/store';
import { minutesSince } from '@/lib/time';
import { advance } from '@/domain/orderMachine';
import { applyStationFilter, type DisplayOrder } from '@/lib/station/filterOrdersByCategory';
import type { Order, OrderStatus } from '@/domain/types';
import { Props, COLUMN_LABELS, ALL_STATUSES } from './kitchen/shared';
import ProductionSummary from './kitchen/ProductionSummary';
import KitchenOrderCard from './kitchen/KitchenOrderCard';

// ─── KitchenStation ───────────────────────────────────────────────────────────

export default function KitchenStation({ station, restaurantName, onLock }: Props) {
  const { orders, online, advanceOrder, adjustPrepTime, logKitchenEvent, remakeOrder } = useStationOrders(station, onLock);
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
      if (next.has(orderId)) { next.delete(orderId); } else { next.add(orderId); }
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
