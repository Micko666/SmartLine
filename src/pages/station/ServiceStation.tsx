import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Flame, CheckCircle2, ArrowRight, Map as MapIcon, List, ChevronRight, Table2 } from 'lucide-react';
import { toast } from 'sonner';
import StationLayout from '@/components/station/StationLayout';
import FloorMapCanvas from '@/components/floor/FloorMapCanvas';
import TablePanel from '@/components/station/TablePanel';
import { useStationOrders } from '@/lib/supabase/realtime/useStationOrders';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { advance, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { minutesSince } from '@/lib/time';
import type { Station, Order, OrderStatus, Table } from '@/domain/types';

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

// ─── OrderListRow ─────────────────────────────────────────────────────────────
// A compact tappable row in list mode — clicking opens the table panel.

function OrderListRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const mins = minutesSince(order.createdAt);
  const isReady  = order.status === 'ready';
  const isLate   = mins > (order.estimatedPrepTime + order.prepTimeAdjustment) && !isReady;
  const accentColor = ORDER_STATUS_COLORS[order.status as OrderStatus] ?? '#64748b';

  return (
    <button
      onClick={onClick}
      className="w-full text-left relative flex items-center gap-3 px-4 py-3.5 border-b border-border/60 hover:bg-muted/40 active:bg-muted/70 transition-colors"
    >
      {/* Ready accent stripe */}
      {isReady && (
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-green-500" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-semibold text-sm text-foreground">{order.tableName}</span>
          </div>
          <span className="text-xs text-muted-foreground">#{order.orderNumber}</span>
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ml-auto"
            style={{ backgroundColor: accentColor + '20', color: accentColor }}
          >
            {STATUS_LABEL[order.status] ?? order.status}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            {isLate && <Flame className="w-3 h-3 text-destructive" />}
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground tabular-nums">{mins}m</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground/80 truncate mt-0.5">
          {order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ')}
        </p>
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground/30 shrink-0 ml-1" />
    </button>
  );
}

// ─── ServiceStation ───────────────────────────────────────────────────────────

export default function ServiceStation({ station, restaurantToken, userId, restaurantName, onLock }: Props) {
  const { orders, online, advanceOrder } = useStationOrders(restaurantToken, userId);
  const { tables, decorations, menuItems, setTableStatus } = useStore(useShallow(s => ({
    tables:         s.tables,
    decorations:    s.decorations,
    menuItems:      s.menuItems,
    setTableStatus: s.setTableStatus,
  })));

  const [advancing, setAdvancing] = useState<Set<string>>(new Set());
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);

  // Map is the default if the station has map access; otherwise fall back to list.
  const [listMode, setListMode] = useState(!station.permissions.mapAccess);

  const defaultStatuses: OrderStatus[] = ['paid', 'preparing', 'ready'];
  const visibleStatuses = station.permissions.visibleStatuses.length > 0
    ? defaultStatuses.filter(s => station.permissions.visibleStatuses.includes(s))
    : defaultStatuses;

  const visible = orders.filter(o => visibleStatuses.includes(o.status as OrderStatus));

  // Full active picture — used for floor map badges and table panels
  const allActiveOrders = orders.filter(o => defaultStatuses.includes(o.status as OrderStatus));

  const { filterCategories, categoryMode } = station.permissions;

  // Sorted for list view: ready → late → by elapsed time
  const sortedOrders = [...visible].sort((a, b) => {
    const aReady = a.status === 'ready' ? 0 : 1;
    const bReady = b.status === 'ready' ? 0 : 1;
    if (aReady !== bReady) return aReady - bReady;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  // ── Action handlers ──────────────────────────────────────────────────────────

  async function handleAdvance(order: Order) {
    const next = advance(order.status as OrderStatus);
    if (!next) return;
    setAdvancing(s => new Set(s).add(order.id));
    const ok = await advanceOrder(order.id, next);
    setAdvancing(s => { const n = new Set(s); n.delete(order.id); return n; });
    if (!ok) { toast.error('Failed to update order'); return; }

    // When final delivery happens and station can update table status
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

  function openTablePanel(tableId: string | null | undefined) {
    if (!tableId) return;
    const table = tables.find(t => t.id === tableId);
    if (table) setSelectedTable(table);
  }

  // Orders for the selected table — full picture regardless of station filter.
  // TablePanel applies its own category filter for display.
  const selectedTableOrders = selectedTable
    ? allActiveOrders.filter(o => o.tableId === selectedTable.id)
    : [];

  const sharedPanelProps = selectedTable ? {
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

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <StationLayout station={station} restaurantName={restaurantName} onLock={onLock} online={online}>
      <div className="absolute inset-0 overflow-hidden">

        {/* ── Map view ─────────────────────────────────────────────────────── */}
        {!listMode && (
          <div className="absolute inset-0 p-3 sm:p-4 flex gap-3">

            {/* Canvas */}
            <div className="flex-1 flex flex-col min-w-0 relative">
              <FloorMapCanvas
                tables={tables}
                decorations={decorations}
                orders={allActiveOrders}
                selectedTableId={selectedTable?.id ?? null}
                onTableClick={table => setSelectedTable(
                  prev => prev?.id === table.id ? null : table,
                )}
              />

              {/* Toggle to list — floating pill, top-right of map */}
              <button
                onClick={() => setListMode(true)}
                className="absolute top-2 right-14 z-10 flex items-center gap-1.5 h-7 px-2.5 rounded-xl bg-background/90 backdrop-blur-sm border border-border shadow-sm text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-background transition-all"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">List</span>
              </button>

              {/* Hint when no table is selected */}
              {!selectedTable && visible.length > 0 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
                  <p className="text-[11px] text-muted-foreground/60 bg-background/80 backdrop-blur-sm px-3 py-1 rounded-full border border-border/50">
                    Tap a table to see its orders
                  </p>
                </div>
              )}
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

        {/* ── List view ────────────────────────────────────────────────────── */}
        {listMode && (
          <div className="absolute inset-0 flex flex-col">

            {/* List header bar */}
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border shrink-0 bg-background/80 backdrop-blur-sm">
              <span className="text-sm font-medium text-foreground">
                {visible.length === 0
                  ? 'No active orders'
                  : `${visible.length} order${visible.length !== 1 ? 's' : ''}`}
                {visible.filter(o => o.status === 'ready').length > 0 && (
                  <span className="ml-2 text-xs font-semibold text-green-600">
                    · {visible.filter(o => o.status === 'ready').length} ready
                  </span>
                )}
              </span>

              {station.permissions.mapAccess && (
                <button
                  onClick={() => setListMode(false)}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded-xl border border-border text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  Map
                </button>
              )}
            </div>

            {/* Order rows or empty state */}
            <div className="flex-1 overflow-y-auto">
              {sortedOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
                  <CheckCircle2 className="w-10 h-10 text-muted-foreground/25" />
                  <p className="text-muted-foreground font-medium">All clear — no active orders</p>
                  {station.permissions.mapAccess && (
                    <button
                      onClick={() => setListMode(false)}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                    >
                      <MapIcon className="w-4 h-4" /> View floor map
                    </button>
                  )}
                </div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {sortedOrders.map(order => (
                    <motion.div
                      key={order.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
                    >
                      <OrderListRow
                        order={order}
                        onClick={() => openTablePanel(order.tableId)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Bottom sheet for selected table */}
            <AnimatePresence>
              {selectedTable && sharedPanelProps && (
                <TablePanel {...sharedPanelProps} variant="sheet" />
              )}
            </AnimatePresence>
          </div>
        )}

      </div>
    </StationLayout>
  );
}
