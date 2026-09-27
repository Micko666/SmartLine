import { ShoppingBag, Plus, Minus, X, Clock, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CartItem, MenuItem, Order } from '@/domain/types';
import { ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';

// ─── Cart Sheet ───────────────────────────────────────────────────────────────
export default function CartSheet({ cart, menuItems, sym, cartTotal, taxAmount, cartTotalWithTax, estimatedWait, taxDisplay, taxRate, issues, sessionOrders, onUpdateQty, onRemove, onClose, onProceed }: {
  cart: CartItem[]; menuItems: MenuItem[]; sym: string;
  cartTotal: number; taxAmount: number; cartTotalWithTax: number; estimatedWait: number;
  taxDisplay: string; taxRate: number; issues: string[];
  sessionOrders: Order[];
  onUpdateQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onProceed: () => void;
}) {
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
            <h2 className="font-display text-lg font-bold">Your Cart</h2>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-5 h-5" /></button>
          </div>

          {issues.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Items updated</p>
                <p className="text-xs mt-0.5">{issues.join(', ')} {issues.length === 1 ? 'was' : 'were'} removed or reduced due to stock changes.</p>
              </div>
            </div>
          )}

          {cart.length === 0 ? (
            <div className="text-center py-10">
              <ShoppingBag className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Your cart is empty.</p>
            </div>
          ) : (
            <>
              <div className="space-y-4 mb-5">
                {cart.map(ci => {
                  const item = menuItems.find(m => m.id === ci.menuItemId);
                  if (!item) return null;
                  const modExtra = ci.selectedModifiers.reduce((s, sel) => {
                    const mod = item.modifiers.find(m => m.id === sel.modifierId);
                    const opt = mod?.options.find(o => o.id === sel.optionId);
                    return s + (opt?.priceAdjustment ?? 0);
                  }, 0);
                  const unitPrice = item.price + modExtra;
                  return (
                    <div key={`${ci.menuItemId}-${JSON.stringify(ci.selectedModifiers)}`} className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted flex items-center justify-center shrink-0">
                        {item.imageUrl || item.thumbnailUrl
                          ? <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                          : <span className="text-xl">{item.icon}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        {ci.selectedModifiers.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {ci.selectedModifiers.map(sel => {
                              const mod = item.modifiers.find(m => m.id === sel.modifierId);
                              const opt = mod?.options.find(o => o.id === sel.optionId);
                              return opt?.name;
                            }).filter(Boolean).join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">{sym}{unitPrice.toFixed(2)} each</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => onUpdateQty(ci.menuItemId, -1)} className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                        <span className="text-sm font-bold w-5 text-center">{ci.quantity}</span>
                        <button onClick={() => onUpdateQty(ci.menuItemId, 1)} className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{sym}{(unitPrice * ci.quantity).toFixed(2)}</p>
                        <button onClick={() => onRemove(ci.menuItemId)} className="text-xs text-destructive/60 hover:text-destructive"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border pt-4 space-y-2 mb-5">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{sym}{cartTotal.toFixed(2)}</span></div>
                {taxDisplay === 'exclusive' && taxAmount > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax ({taxRate}%)</span><span>{sym}{taxAmount.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                  <span>Total</span><span>{sym}{cartTotalWithTax.toFixed(2)}</span>
                </div>
                {estimatedWait > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                    <Clock className="w-3.5 h-3.5" /> ~{estimatedWait} min estimated wait
                  </div>
                )}
              </div>

              <button
                onClick={onProceed}
                className="w-full h-13 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity py-3.5"
              >
                Proceed to Payment · {sym}{cartTotalWithTax.toFixed(2)}
              </button>
            </>
          )}

          {sessionOrders.length > 0 && (
            <div className="mt-6 pt-5 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Already ordered this visit</p>
              <div className="space-y-2">
                {sessionOrders.map(order => (
                  <div key={order.id} className="flex items-center justify-between py-2 px-3 rounded-xl bg-muted/40 text-sm">
                    <div>
                      <span className="font-semibold">#{order.orderNumber}</span>
                      <span className="text-muted-foreground ml-2">{order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(', ')}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                      <span className="font-medium">{sym}{order.total.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
