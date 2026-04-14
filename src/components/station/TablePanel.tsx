/**
 * TablePanel — shows active orders for a selected table.
 * Used by ServiceStation and BarStation.
 *
 * variant="panel"  → desktop side panel (slides in beside floor map)
 * variant="sheet"  → mobile bottom sheet (overlays current view)
 */

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X, ArrowRight } from 'lucide-react';
import { advance, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { applyStationFilter } from '@/lib/station/filterOrdersByCategory';
import { minutesSince } from '@/lib/time';
import type { Table, Order, MenuItem, OrderItem, OrderStatus, CategoryMode } from '@/domain/types';

// ─── OrderRowInPanel ──────────────────────────────────────────────────────────

function ItemLine({ item, dimmed }: { item: OrderItem; dimmed?: boolean }) {
  return (
    <span className={`transition-opacity ${dimmed ? 'opacity-30' : ''}`}>
      {item.quantity}× {item.menuItemName}
    </span>
  );
}

function OrderRowInPanel({
  order, primaryItems, contextItems, canAdvance, isAdvancing, onAdvance,
}: {
  order: Order;
  primaryItems: OrderItem[];
  contextItems: OrderItem[];
  canAdvance: boolean;
  isAdvancing: boolean;
  onAdvance: () => void;
}) {
  const isReady = order.status === 'ready';
  const nextStatus = advance(order.status as OrderStatus);
  const accentColor = ORDER_STATUS_COLORS[order.status as OrderStatus] ?? '#64748b';
  const mins = minutesSince(order.createdAt);

  const STATUS_LABEL: Record<string, string> = {
    paid: 'Waiting', preparing: 'Cooking', ready: 'Ready',
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${isReady ? 'border-green-500/40' : 'border-border'}`}>
      {isReady && <div className="h-0.5 bg-green-500" />}
      <div className="p-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
              <span className="font-semibold text-xs text-foreground">#{order.orderNumber}</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: accentColor + '20', color: accentColor }}
              >{STATUS_LABEL[order.status] ?? order.status}</span>
              <span className="text-[10px] text-muted-foreground ml-auto tabular-nums">{mins}m</span>
            </div>
            <div className="text-xs text-foreground/80 leading-relaxed flex flex-wrap gap-x-2 gap-y-0.5">
              {primaryItems.map(i => (
                <ItemLine key={`${i.menuItemId}-${i.quantity}`} item={i} dimmed={false} />
              ))}
              {contextItems.map(i => (
                <ItemLine key={`ctx-${i.menuItemId}-${i.quantity}`} item={i} dimmed={true} />
              ))}
            </div>
            {order.notes && (
              <p className="text-[10px] text-muted-foreground italic mt-1 border-l-2 border-muted pl-1.5 line-clamp-1">
                {order.notes}
              </p>
            )}
          </div>
          {canAdvance && nextStatus && (
            <button
              onClick={onAdvance}
              disabled={isAdvancing}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all active:scale-95 disabled:opacity-50 ${
                isReady
                  ? 'bg-green-500 text-white hover:bg-green-600'
                  : 'border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {isReady ? <ArrowRight className="w-3 h-3" /> : null}
              {isReady ? 'Deliver' : ORDER_STATUS_LABELS[nextStatus]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── TablePanel ───────────────────────────────────────────────────────────────

export interface TablePanelProps {
  table: Table;
  orders: Order[];
  canAdvance: boolean;
  canUpdateTableStatus: boolean;
  onAdvance: (order: Order) => void;
  onClose: () => void;
  onClearTable: () => void;
  advancing: Set<string>;
  variant: 'panel' | 'sheet';
  filterCategories: string[];
  categoryMode: CategoryMode;
  menuItems: MenuItem[];
}

export default function TablePanel({
  table, orders, canAdvance, canUpdateTableStatus,
  onAdvance, onClose, onClearTable, advancing, variant,
  filterCategories, categoryMode, menuItems,
}: TablePanelProps) {
  const hasReady = orders.some(o => o.status === 'ready');
  const allDone  = orders.length === 0 || orders.every(o => o.status === 'completed' || o.status === 'cancelled');

  const displayOrders = applyStationFilter(orders, menuItems, filterCategories, categoryMode);

  const header = (
    <div className={`relative flex items-start gap-3 px-4 pt-4 pb-3 border-b border-border shrink-0 ${hasReady ? 'bg-green-500/5' : ''}`}>
      {hasReady && <div className="absolute top-0 left-0 right-0 h-0.5 bg-green-500" />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-black text-2xl text-foreground leading-none">{table.number}</span>
          <span className="font-semibold text-foreground">{table.name}</span>
          {table.zone && (
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
              {table.zone}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {table.capacity} seats ·{' '}
          <span className={hasReady ? 'text-green-600 font-medium' : ''}>
            {displayOrders.length === 0
              ? 'No active orders'
              : `${displayOrders.length} order${displayOrders.length !== 1 ? 's' : ''}${hasReady ? ' · Ready!' : ''}`}
          </span>
        </p>
      </div>
      <button
        onClick={onClose}
        className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground shrink-0 mt-0.5"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );

  const body = (
    <div className="flex-1 overflow-y-auto">
      {displayOrders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
          <CheckCircle2 className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No active orders</p>
        </div>
      ) : (
        <div className="p-3 space-y-2">
          {displayOrders.map(({ order, items: primaryItems, context: contextItems }) => (
            <OrderRowInPanel
              key={order.id}
              order={order}
              primaryItems={primaryItems}
              contextItems={contextItems}
              canAdvance={canAdvance && !advancing.has(order.id)}
              isAdvancing={advancing.has(order.id)}
              onAdvance={() => onAdvance(order)}
            />
          ))}
        </div>
      )}

      {canUpdateTableStatus && (table.status === 'occupied' || table.status === 'reserved') && (
        <div className="px-3 pb-3">
          <div className="border-t border-border pt-3">
            <button
              onClick={onClearTable}
              disabled={!allDone}
              className="w-full flex items-center justify-center gap-2 h-9 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!allDone ? 'Deliver all orders first' : 'Mark table as available'}
            >
              <CheckCircle2 className="w-4 h-4" />
              Clear table
            </button>
            {!allDone && (
              <p className="text-[10px] text-muted-foreground/60 text-center mt-1.5">
                Deliver all orders first
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (variant === 'panel') {
    return (
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 16 }}
        className="relative w-72 shrink-0 flex flex-col bg-card border border-border rounded-2xl overflow-hidden shadow-sm"
      >
        {header}
        {body}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-30 flex flex-col justify-end"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={e => e.stopPropagation()}
        className="relative bg-card rounded-t-3xl border-t border-border shadow-2xl max-h-[80%] flex flex-col"
      >
        {header}
        {body}
      </motion.div>
    </motion.div>
  );
}
