import { X, ClipboardList } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Order } from '@/domain/types';
import { ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// ─── Session Orders Sheet ─────────────────────────────────────────────────────
export default function SessionOrdersSheet({ orders, sym, onClose }: { orders: Order[]; sym: string; onClose: () => void }) {
  useEscapeKey(onClose);
  const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl max-h-[85vh] overflow-y-auto"
      >
        <div className="max-w-lg mx-auto p-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-lg font-bold">Your Orders This Visit</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Everything you've ordered since scanning in</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-5 h-5" /></button>
          </div>

          {orders.length === 0 ? (
            <div className="text-center py-10">
              <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No orders placed yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(order => (
                <div key={order.id} className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">#{order.orderNumber}</span>
                      <span className="text-xs text-muted-foreground">{order.tableName}</span>
                    </div>
                    <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {order.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {item.menuItemIcon} {item.quantity}× {item.menuItemName}
                          {item.modifiers.length > 0 && <span className="text-xs"> · {item.modifiers.map(m => m.optionName).join(', ')}</span>}
                        </span>
                        <span className="font-medium shrink-0 ml-3">{sym}{item.lineTotal.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border">
                    <span>Order total</span>
                    <span>{sym}{order.total.toFixed(2)}</span>
                  </div>
                </div>
              ))}
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
                <div className="flex justify-between font-bold text-base">
                  <span>Total this visit</span>
                  <span className="text-primary">{sym}{totalSpent.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {orders.length} order{orders.length !== 1 ? 's' : ''} · payment at counter or as arranged
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
