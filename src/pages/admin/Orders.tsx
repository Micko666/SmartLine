import { useState } from 'react';
import { CheckCircle2, Clock, ChefHat, CreditCard, ArrowRight, X, RotateCcw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { advance, canTransition, ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';
import type { OrderStatus, Order, KitchenEventType } from '@/domain/types';
import { toast } from 'sonner';

const STATUS_ICONS: Record<OrderStatus, React.ElementType> = {
  paid: CreditCard,
  preparing: ChefHat,
  ready: Clock,
  completed: CheckCircle2,
  cancelled: X,
  refunded: RotateCcw,
};

const TABS: { label: string; value: OrderStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Paid', value: 'paid' },
  { label: 'Preparing', value: 'preparing' },
  { label: 'Ready', value: 'ready' },
  { label: 'Completed', value: 'completed' },
];

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : `${m}m ago`;
}

export default function Orders() {
  const { orders, advanceOrderStatus, cancelOrder, logKitchenEvent, settings } = useStore(useShallow(s => ({
    orders:            s.orders,
    advanceOrderStatus: s.advanceOrderStatus,
    cancelOrder:       s.cancelOrder,
    logKitchenEvent:   s.logKitchenEvent,
    settings:          s.settings,
  })));

  const [filter,      setFilter]      = useState<OrderStatus | 'all'>('all');
  const [eventOrder,  setEventOrder]  = useState<Order | null>(null);
  const sym = settings.currencySymbol;

  const filtered = filter === 'all' ? orders : orders.filter(o => o.status === filter);
  const counts = TABS.reduce((acc, t) => {
    acc[t.value] = t.value === 'all' ? orders.length : orders.filter(o => o.status === t.value).length;
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

        {/* Orders */}
        {filtered.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-muted-foreground">No orders{filter !== 'all' ? ` in "${ORDER_STATUS_LABELS[filter as OrderStatus]}"` : ''} yet.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            <AnimatePresence mode="popLayout">
              {filtered.map(order => {
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
                      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(order.createdAt)}</span>
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
        )}
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
