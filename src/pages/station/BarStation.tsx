/**
 * BarStation — focused drink/bar order surface.
 *
 * Grouped by urgency: Ready first, then Making, then New.
 * Category-filtered via station.permissions (bar typically shows only drink items).
 * Late orders get a prominent red accent.
 *
 * Clicking a table name opens a TablePanel (same component as ServiceStation)
 * so bar staff can see the full table context, deliver, and clear the table.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Flame, CheckCircle2, GlassWater, ChevronRight, Filter } from 'lucide-react';
import { toast } from 'sonner';
import StationLayout from '@/components/station/StationLayout';
import SectionHeader from '@/components/station/SectionHeader';
import TablePanel from '@/components/station/TablePanel';
import { useStationOrders } from '@/lib/supabase/realtime/useStationOrders';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { applyStationFilter, type DisplayOrder } from '@/lib/station/filterOrdersByCategory';
import { advance, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { minutesSince } from '@/lib/time';
import type { Station, Order, OrderStatus, OrderItem, Table } from '@/domain/types';

interface Props {
  station: Station;
  restaurantToken: string;
  userId: string;
  restaurantName: string;
  onLock: () => void;
}

// ─── BarOrderRow ──────────────────────────────────────────────────────────────

function BarOrderRow({
  order, items, otherItems, canAdvance, canCancel, onAdvance, onCancel, onTableClick,
}: {
  order: Order;
  items: OrderItem[];
  otherItems?: OrderItem[];
  canAdvance: boolean;
  canCancel: boolean;
  onAdvance: () => void;
  onCancel: () => void;
  onTableClick: () => void;
}) {
  const mins = minutesSince(order.createdAt);
  const isLate = mins > (order.estimatedPrepTime + order.prepTimeAdjustment) && order.status !== 'ready';
  const nextStatus = advance(order.status as OrderStatus);
  const accent = isLate ? '#ef4444' : (ORDER_STATUS_COLORS[order.status as OrderStatus] ?? '#64748b');

  return (
    <motion.div layout
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      className="flex items-center gap-3 bg-card border border-border rounded-2xl overflow-hidden"
    >
      {/* Status accent bar */}
      <div className="w-1 self-stretch shrink-0" style={{ backgroundColor: accent }} />

      {/* Info */}
      <div className="flex-1 min-w-0 py-3 pr-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-foreground text-sm">#{order.orderNumber}</span>
          <button
            onClick={onTableClick}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-primary transition-colors group truncate"
          >
            <span className="truncate group-hover:text-primary">{order.tableName}</span>
            <ChevronRight className="w-3 h-3 shrink-0 opacity-40 group-hover:opacity-100 group-hover:text-primary" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ')}
          {otherItems && otherItems.length > 0 && (
            <span className="opacity-40 ml-1">
              · {otherItems.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ')}
            </span>
          )}
        </p>
      </div>

      {/* Time */}
      <div className="flex items-center gap-1 shrink-0">
        {isLate ? <Flame className="w-3.5 h-3.5 text-destructive" /> : <Clock className="w-3 h-3 text-muted-foreground" />}
        <span className={`text-xs font-medium tabular-nums ${isLate ? 'text-destructive' : 'text-muted-foreground'}`}>{mins}m</span>
      </div>

      {/* Advance */}
      {canAdvance && nextStatus ? (
        <button onClick={onAdvance}
          className="flex items-center gap-1 px-3 py-3 text-sm font-semibold transition-all active:scale-95 shrink-0"
          style={{ color: accent }}
        >
          <ChevronRight className="w-4 h-4" />
          <span className="hidden sm:inline text-xs">{ORDER_STATUS_LABELS[nextStatus]}</span>
        </button>
      ) : canCancel ? (
        <button onClick={onCancel}
          className="px-3 py-3 text-destructive/60 hover:text-destructive transition-colors shrink-0"
          title="Cancel order"
        >
          <span className="text-sm font-medium">✕</span>
        </button>
      ) : (
        <div className="w-10" />
      )}
    </motion.div>
  );
}

// ─── BarStation ───────────────────────────────────────────────────────────────

export default function BarStation({ station, restaurantToken, userId, restaurantName, onLock }: Props) {
  const { orders, online, advanceOrder } = useStationOrders(restaurantToken, userId, station.id);
  const [advancing, setAdvancing] = useState<Set<string>>(new Set());
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  const { tables, menuItems, setTableStatus } = useStore(useShallow(s => ({
    tables:         s.tables,
    menuItems:      s.menuItems,
    setTableStatus: s.setTableStatus,
  })));

  const { filterCategories, categoryMode } = station.permissions;
  const filterActive = filterCategories.length > 0;

  const defaultStatuses: OrderStatus[] = ['paid', 'preparing', 'ready'];
  const visibleStatuses = station.permissions.visibleStatuses.length > 0
    ? defaultStatuses.filter(s => station.permissions.visibleStatuses.includes(s))
    : defaultStatuses;

  const statusFiltered = orders.filter(o => visibleStatuses.includes(o.status as OrderStatus));
  const displayOrders: DisplayOrder[] = applyStationFilter(statusFiltered, menuItems, filterCategories, categoryMode);

  // All active orders used for TablePanel (full picture, not category-filtered)
  const allActiveOrders = orders.filter(o => defaultStatuses.includes(o.status as OrderStatus));

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

  function openTablePanel(tableId: string | null | undefined) {
    if (!tableId) return;
    const table = tables.find(t => t.id === tableId);
    if (table) setSelectedTable(table);
  }

  const readyOrders     = displayOrders.filter(d => d.order.status === 'ready');
  const preparingOrders = displayOrders.filter(d => d.order.status === 'preparing');
  const paidOrders      = displayOrders.filter(d => d.order.status === 'paid');

  function rowProps(d: DisplayOrder) {
    return {
      key:          d.order.id,
      order:        d.order,
      items:        d.items,
      otherItems:   d.context.length > 0 ? d.context : undefined,
      canAdvance:   station.permissions.canAdvanceOrders && !advancing.has(d.order.id),
      canCancel:    station.permissions.canCancelOrders && !advancing.has(d.order.id),
      onAdvance:    () => handleAdvance(d.order),
      onCancel:     () => handleCancel(d.order),
      onTableClick: () => openTablePanel(d.order.tableId),
    };
  }

  const selectedTableOrders = selectedTable
    ? allActiveOrders.filter(o => o.tableId === selectedTable.id)
    : [];

  const panelProps = selectedTable ? {
    table:                selectedTable,
    orders:               selectedTableOrders,
    canAdvance:           station.permissions.canAdvanceOrders,
    canUpdateTableStatus: station.permissions.canUpdateTableStatus,
    onAdvance:            handleAdvance,
    onClose:              () => setSelectedTable(null),
    onClearTable: () => {
      setTableStatus(selectedTable.id, 'available');
      setSelectedTable(null);
      toast.success(`${selectedTable.name} marked as available`);
    },
    advancing,
    filterCategories,
    categoryMode,
    menuItems,
  } : null;

  return (
    <StationLayout station={station} restaurantName={restaurantName} onLock={onLock} online={online}>
      <div className="absolute inset-0 overflow-y-auto p-4">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Active filter indicator */}
          {filterActive && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/20">
              <Filter className="w-3.5 h-3.5 text-primary shrink-0" />
              <span className="text-xs text-primary font-medium">
                Showing: {filterCategories.join(', ')}
              </span>
            </div>
          )}

          {displayOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
              <GlassWater className="w-12 h-12 text-muted-foreground/30" />
              <p className="text-muted-foreground font-medium">No active orders</p>
              {filterActive && (
                <p className="text-xs text-muted-foreground">
                  Filtering to: {filterCategories.join(', ')}
                </p>
              )}
            </div>
          ) : (
            <>
              {readyOrders.length > 0 && (
                <section>
                  <SectionHeader label="Ready to Pour" count={readyOrders.length} color="#22c55e" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-1.5">
                      {readyOrders.map(entry => <BarOrderRow {...rowProps(entry)} />)}
                    </div>
                  </AnimatePresence>
                </section>
              )}

              {preparingOrders.length > 0 && (
                <section>
                  <SectionHeader label="Making" count={preparingOrders.length} color="#f97316" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-1.5">
                      {preparingOrders.map(entry => <BarOrderRow {...rowProps(entry)} />)}
                    </div>
                  </AnimatePresence>
                </section>
              )}

              {paidOrders.length > 0 && (
                <section>
                  <SectionHeader label="New" count={paidOrders.length} color="#eab308" />
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-1.5">
                      {paidOrders.map(entry => <BarOrderRow {...rowProps(entry)} />)}
                    </div>
                  </AnimatePresence>
                </section>
              )}

              <div className="flex items-center justify-center gap-2 pt-2 text-xs text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {displayOrders.length} active order{displayOrders.length !== 1 ? 's' : ''}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table panel — bottom sheet when a table name is tapped */}
      <AnimatePresence>
        {selectedTable && panelProps && (
          <TablePanel {...panelProps} variant="sheet" />
        )}
      </AnimatePresence>
    </StationLayout>
  );
}
