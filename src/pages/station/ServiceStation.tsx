import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Flame, CheckCircle2, Table2, ArrowRight, LayoutList, AlignJustify, Map as MapIcon, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import StationLayout from '@/components/station/StationLayout';
import FloorMapCanvas from '@/components/floor/FloorMapCanvas';
import SectionHeader from '@/components/station/SectionHeader';
import TablePanel from '@/components/station/TablePanel';
import { useStationOrders } from '@/lib/supabase/realtime/useStationOrders';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { advance, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { minutesSince } from '@/lib/time';
import type { Station, Order, OrderStatus, Table, MenuItem } from '@/domain/types';

interface Props {
  station: Station;
  restaurantToken: string;
  userId: string;
  restaurantName: string;
  onLock: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  paid:      'Waiting',
  preparing: 'Cooking',
  ready:     'Ready',
};

// ─── ServiceCard ──────────────────────────────────────────────────────────────

function ServiceCard({
  order, canAdvance, canCancel, onAdvance, onCancel, onTableClick, compact,
}: {
  order: Order;
  canAdvance: boolean;
  canCancel: boolean;
  onAdvance: () => void;
  onCancel: () => void;
  onTableClick?: () => void;
  compact?: boolean;
}) {
  const mins = minutesSince(order.createdAt);
  const nextStatus = advance(order.status as OrderStatus);
  const isReady = order.status === 'ready';
  const isLate = mins > (order.estimatedPrepTime + order.prepTimeAdjustment) && order.status !== 'completed';

  return (
    <motion.div layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={`bg-card border rounded-2xl overflow-hidden transition-all ${
        isReady
          ? 'border-green-500/40 shadow-[0_0_0_1px_rgba(34,197,94,0.12)]'
          : 'border-border'
      }`}
    >
      {isReady && <div className="h-0.5 bg-green-500" />}

      <div className={`flex items-start gap-3 ${compact ? 'p-3' : 'p-4'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {onTableClick ? (
              <button
                onClick={onTableClick}
                className="flex items-center gap-1 hover:text-primary transition-colors group"
              >
                <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 group-hover:text-primary" />
                <span className="font-semibold text-foreground text-sm group-hover:text-primary">{order.tableName}</span>
                <ChevronRight className="w-3 h-3 text-muted-foreground/40 group-hover:text-primary" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="font-semibold text-foreground text-sm">{order.tableName}</span>
              </div>
            )}
            <span className="text-muted-foreground text-xs">#{order.orderNumber}</span>
            <div className="flex items-center gap-1 ml-auto shrink-0">
              {isLate ? <Flame className="w-3.5 h-3.5 text-destructive" /> : <Clock className="w-3 h-3 text-muted-foreground" />}
              <span className="text-xs text-muted-foreground tabular-nums">{mins}m</span>
            </div>
          </div>

          <p className={`text-muted-foreground leading-relaxed mt-1 ${compact ? 'text-xs' : 'text-sm'}`}>
            {order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ')}
          </p>

          {order.notes && (
            <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2 mt-1 line-clamp-1">{order.notes}</p>
          )}
        </div>

        {isReady && canAdvance && nextStatus && (
          <button onClick={onAdvance}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-green-500 text-white text-sm font-semibold shrink-0 transition-all active:scale-95 hover:bg-green-600"
          >
            <ArrowRight className="w-4 h-4" />
            <span className="hidden sm:inline">Deliver</span>
          </button>
        )}
        {!isReady && canAdvance && nextStatus && (
          <button onClick={onAdvance}
            className="flex items-center gap-1 px-3 py-2 rounded-xl border border-border text-muted-foreground text-xs font-medium shrink-0 hover:bg-muted transition-all active:scale-95"
          >
            {ORDER_STATUS_LABELS[nextStatus]}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── TableGroup (for by-table view) ──────────────────────────────────────────

function TableGroup({
  tableName, orders, canAdvance, canCancel, onAdvance, onCancel, onOpenPanel,
}: {
  tableName: string;
  orders: Order[];
  canAdvance: (o: Order) => boolean;
  canCancel: (o: Order) => boolean;
  onAdvance: (o: Order) => void;
  onCancel: (o: Order) => void;
  onOpenPanel?: () => void;
}) {
  const hasReady = orders.some(o => o.status === 'ready');
  const hasLate = orders.some(o =>
    minutesSince(o.createdAt) > (o.estimatedPrepTime + o.prepTimeAdjustment) && o.status !== 'ready',
  );

  return (
    <div className={`rounded-2xl border overflow-hidden ${hasReady ? 'border-green-500/30' : 'border-border'}`}>
      {hasReady && <div className="h-0.5 bg-green-500" />}
      <div className={`px-3 pt-3 pb-1 flex items-center gap-2 ${hasReady ? 'bg-green-500/5' : ''}`}>
        <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        {onOpenPanel ? (
          <button
            onClick={onOpenPanel}
            className="flex items-center gap-1 font-semibold text-sm text-foreground hover:text-primary transition-colors group"
          >
            {tableName}
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-primary" />
          </button>
        ) : (
          <span className="font-semibold text-sm text-foreground">{tableName}</span>
        )}
        {hasLate && <Flame className="w-3.5 h-3.5 text-destructive shrink-0" title="Late order" />}
        <div className="flex gap-1 ml-auto">
          {orders.map(o => (
            <span key={o.id} className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
              style={{ backgroundColor: (ORDER_STATUS_COLORS[o.status as OrderStatus] ?? '#64748b') + '20', color: ORDER_STATUS_COLORS[o.status as OrderStatus] ?? '#64748b' }}
            >{STATUS_LABEL[o.status] ?? o.status}</span>
          ))}
        </div>
      </div>
      <div className="p-2 space-y-1.5">
        {orders.map(order => (
          <motion.div key={order.id} layout
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex items-center gap-3 rounded-xl px-3 py-2 bg-muted/40"
          >
            <span className="text-xs text-muted-foreground w-8 shrink-0">#{order.orderNumber}</span>
            <p className="text-xs text-foreground/80 flex-1 truncate">
              {order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ')}
            </p>
            {order.status === 'ready' && canAdvance(order) && (
              <button onClick={() => onAdvance(order)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-xs font-semibold shrink-0 transition-all active:scale-95"
              >
                <ArrowRight className="w-3 h-3" />
                Deliver
              </button>
            )}
            {order.status !== 'ready' && canAdvance(order) && (
              <span className="text-[10px] font-medium shrink-0" style={{ color: ORDER_STATUS_COLORS[order.status as OrderStatus] }}>
                {STATUS_LABEL[order.status]}
              </span>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── ServiceStation ───────────────────────────────────────────────────────────

export default function ServiceStation({ station, restaurantToken, userId, restaurantName, onLock }: Props) {
  const { orders, online, advanceOrder } = useStationOrders(restaurantToken, userId);
  const { tables, decorations, menuItems, setTableStatus } = useStore(useShallow(s => ({
    tables: s.tables,
    decorations: s.decorations,
    menuItems: s.menuItems,
    setTableStatus: s.setTableStatus,
  })));

  const [advancing, setAdvancing] = useState<Set<string>>(new Set());

  // Default to floor map if this station has map access — it's the most useful
  // starting view for service staff who need situational awareness
  const [viewMode, setViewMode] = useState<'urgency' | 'table' | 'floor'>(
    station.permissions.mapAccess ? 'floor' : 'urgency',
  );

  // Single selected table state — shared across all view modes
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  const defaultStatuses: OrderStatus[] = ['paid', 'preparing', 'ready'];
  const visibleStatuses = station.permissions.visibleStatuses.length > 0
    ? defaultStatuses.filter(s => station.permissions.visibleStatuses.includes(s))
    : defaultStatuses;

  const visible = orders.filter(o => visibleStatuses.includes(o.status as OrderStatus));

  // All active orders — used for floor map badges; always shows complete picture
  const allActiveOrders = orders.filter(o => defaultStatuses.includes(o.status as OrderStatus));

  const { filterCategories, categoryMode } = station.permissions;

  async function handleAdvance(order: Order) {
    const next = advance(order.status as OrderStatus);
    if (!next) return;
    setAdvancing(s => new Set(s).add(order.id));
    const ok = await advanceOrder(order.id, next);
    setAdvancing(s => { const n = new Set(s); n.delete(order.id); return n; });
    if (!ok) { toast.error('Failed to update order'); return; }

    if (next === 'completed' && station.permissions.canUpdateTableStatus && order.tableId) {
      const siblingsStillActive = orders.filter(
        o => o.id !== order.id &&
             o.tableId === order.tableId &&
             defaultStatuses.includes(o.status as OrderStatus),
      );
      if (siblingsStillActive.length === 0) {
        const table = tables.find(t => t.id === order.tableId);
        if (table && table.status === 'occupied') {
          toast.success(`All done at ${table.name}`, {
            action: {
              label: 'Clear table',
              onClick: () => {
                setTableStatus(table.id, 'available');
                toast.success(`${table.name} is now available`);
              },
            },
            duration: 8000,
          });
        }
      }
    }
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

  function closeTablePanel() { setSelectedTable(null); }

  const readyOrders   = visible.filter(o => o.status === 'ready');
  const kitchenOrders = visible.filter(o => o.status === 'paid' || o.status === 'preparing');

  function cardProps(order: Order, compact = false) {
    return {
      key: order.id,
      order,
      canAdvance: station.permissions.canAdvanceOrders && !advancing.has(order.id),
      canCancel: station.permissions.canCancelOrders && !advancing.has(order.id),
      onAdvance: () => handleAdvance(order),
      onCancel: () => handleCancel(order),
      onTableClick: () => openTablePanel(order.tableId),
      compact,
    };
  }

  // Build table groups sorted by urgency then table number
  const tableGroupMap = new Map<string, { tableName: string; tableId: string | null; tableNum: number; orders: Order[] }>();
  for (const order of visible) {
    const key = order.tableId ?? order.tableName;
    const tableNum = tables.find(t => t.id === order.tableId)?.number ?? 9999;
    const entry = tableGroupMap.get(key);
    if (entry) {
      entry.orders.push(order);
    } else {
      tableGroupMap.set(key, { tableName: order.tableName, tableId: order.tableId ?? null, tableNum, orders: [order] });
    }
  }
  const tableGroups = Array.from(tableGroupMap.values()).sort((a, b) => {
    const aReady = a.orders.some(o => o.status === 'ready') ? 0 : 1;
    const bReady = b.orders.some(o => o.status === 'ready') ? 0 : 1;
    return aReady - bReady || a.tableNum - b.tableNum;
  });

  // Orders for selected table — always full picture regardless of station filter
  // (the TablePanel itself will apply the filter for what to show/dim)
  const selectedTableOrders = selectedTable
    ? allActiveOrders.filter(o => o.tableId === selectedTable.id)
    : [];

  const sharedPanelProps = selectedTable ? {
    table: selectedTable,
    orders: selectedTableOrders,
    canAdvance: station.permissions.canAdvanceOrders,
    canUpdateTableStatus: station.permissions.canUpdateTableStatus,
    onAdvance: handleAdvance,
    onClose: closeTablePanel,
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

  if (visible.length === 0 && viewMode !== 'floor') {
    return (
      <StationLayout station={station} restaurantName={restaurantName} onLock={onLock} online={online}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <CheckCircle2 className="w-12 h-12 text-muted-foreground/30" />
          <p className="text-muted-foreground font-medium">All clear — no active orders</p>
          {station.permissions.mapAccess && (
            <button
              onClick={() => setViewMode('floor')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
            >
              <MapIcon className="w-4 h-4" /> View floor map
            </button>
          )}
        </div>
      </StationLayout>
    );
  }

  return (
    <StationLayout station={station} restaurantName={restaurantName} onLock={onLock} online={online}>
      <div className="absolute inset-0 flex flex-col overflow-hidden">

        {/* View toggle bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border shrink-0 bg-background/80 backdrop-blur-sm">
          <button
            onClick={() => setViewMode('urgency')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'urgency' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <AlignJustify className="w-3.5 h-3.5" />
            Urgency
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === 'table' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            Tables
          </button>
          {station.permissions.mapAccess && (
            <button
              onClick={() => setViewMode('floor')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === 'floor' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Map
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {visible.length} order{visible.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex-1 overflow-hidden relative">

          {/* ── Floor map view ── */}
          {viewMode === 'floor' && (
            <div className="absolute inset-0 p-3 sm:p-4 flex gap-3">
              <div className="flex-1 flex flex-col min-w-0">
                <FloorMapCanvas
                  tables={tables}
                  decorations={decorations}
                  orders={allActiveOrders}
                  selectedTableId={selectedTable?.id ?? null}
                  onTableClick={table => {
                    setSelectedTable(prev => prev?.id === table.id ? null : table);
                  }}
                />
              </div>

              {/* Desktop side panel */}
              <AnimatePresence>
                {selectedTable && sharedPanelProps && (
                  <div className="hidden sm:block">
                    <TablePanel {...sharedPanelProps} variant="panel" />
                  </div>
                )}
              </AnimatePresence>

              {/* Mobile bottom sheet */}
              <AnimatePresence>
                {selectedTable && sharedPanelProps && (
                  <div className="sm:hidden absolute inset-0 z-30">
                    <TablePanel {...sharedPanelProps} variant="sheet" />
                  </div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ── List views ── */}
          {viewMode !== 'floor' && (
            <div className="absolute inset-0 overflow-y-auto">
              <div className="max-w-3xl mx-auto p-4 space-y-6">

                {viewMode === 'urgency' ? (
                  <>
                    {readyOrders.length > 0 && (
                      <section>
                        <SectionHeader label="Ready to Serve" count={readyOrders.length} color="#22c55e" />
                        <AnimatePresence mode="popLayout">
                          <div className="space-y-2">
                            {readyOrders.map(o => <ServiceCard {...cardProps(o)} />)}
                          </div>
                        </AnimatePresence>
                      </section>
                    )}
                    {kitchenOrders.length > 0 && (
                      <section>
                        <SectionHeader label="In Kitchen" count={kitchenOrders.length} color="#f97316" />
                        <AnimatePresence mode="popLayout">
                          <div className="space-y-2">
                            {kitchenOrders.map(o => <ServiceCard {...cardProps(o, true)} />)}
                          </div>
                        </AnimatePresence>
                      </section>
                    )}
                  </>
                ) : (
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-3">
                      {tableGroups.map(({ tableName, tableId, orders: tableOrders }) => (
                        <motion.div key={tableName} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                          <TableGroup
                            tableName={tableName}
                            orders={tableOrders}
                            canAdvance={o => station.permissions.canAdvanceOrders && !advancing.has(o.id)}
                            canCancel={o => station.permissions.canCancelOrders && !advancing.has(o.id)}
                            onAdvance={handleAdvance}
                            onCancel={handleCancel}
                            onOpenPanel={tableId ? () => openTablePanel(tableId) : undefined}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </AnimatePresence>
                )}
              </div>

              {/* Table panel sheet — bottom sheet from any list view */}
              <AnimatePresence>
                {selectedTable && sharedPanelProps && (
                  <TablePanel {...sharedPanelProps} variant="sheet" />
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </StationLayout>
  );
}
