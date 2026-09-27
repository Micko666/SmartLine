import { CheckCircle2, Clock, ArrowRight, X, AlertTriangle, Table2, Flame, CalendarClock } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { advance, canTransition, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import { minutesSince } from '@/lib/time';
import type { OrderStatus, Order, Table, TableStatus } from '@/domain/types';
import { TABLE_STATUS_COLOR, TABLE_STATUS_LABEL } from '@/domain/tables';
import { formatScheduledFor, formatTime } from './shared';

// ─── TableOrderGroup ─────────────────────────────────────────────────────────

export default function TableOrderGroup({
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
  const timezone = useStore(st => st.settings.timezone);
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
            {hasLate && <span title="Late order"><Flame className="w-3.5 h-3.5 text-destructive shrink-0" aria-label="Late order" /></span>}
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
                {order.scheduledFor && (
                  <p className="text-[10px] font-medium text-primary mt-0.5 flex items-center gap-1">
                    <CalendarClock className="w-2.5 h-2.5 shrink-0" />{formatScheduledFor(order.scheduledFor, timezone)}
                  </p>
                )}
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
