import { forwardRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Flame, CheckCircle2, AlertCircle, MessageSquare, Play, ChevronDown } from 'lucide-react';
import { type KitchenEventType } from '@/lib/supabase/realtime/useStationOrders';
import { minutesSince } from '@/lib/time';
import { advance, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import type { Order, OrderStatus } from '@/domain/types';
import { STATUS_BG } from './shared';
import PrepTimeBar from './PrepTimeBar';
import LogEventPanel from './LogEventPanel';

// ─── KitchenOrderCard ─────────────────────────────────────────────────────────

interface KitchenOrderCardProps {
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
}

// forwardRef: the card is a direct child of AnimatePresence mode="popLayout",
// which measures exiting children through a ref.
const KitchenOrderCard = forwardRef<HTMLDivElement, KitchenOrderCardProps>(function KitchenOrderCard({
  order, canAdvance, canCancel, canAdjustPrepTime, canReworkOrders,
  onAdvance, onCancel, onAdjustPrepTime, onLog, onRework,
  dimmedItemIds, expanded, onToggleExpanded,
}, ref) {
  const [logOpen, setLogOpen] = useState(false);

  const mins = minutesSince(order.createdAt);
  const totalPrepTime = order.estimatedPrepTime + order.prepTimeAdjustment;
  const isLate = mins > totalPrepTime && order.status !== 'ready';
  const nextStatus = advance(order.status as OrderStatus);
  const accent = ORDER_STATUS_COLORS[order.status as OrderStatus] ?? '#64748b';

  const itemSummary = order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(' · ');

  return (
    <motion.div ref={ref} layout
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
            {order.status === 'placed'
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
                      {order.status === 'placed'
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
});

export default KitchenOrderCard;
