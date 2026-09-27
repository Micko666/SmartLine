import { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Package, Bike, User, Phone, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CartItem, MenuItem, PaymentMethod } from '@/domain/types';
import { formatScheduled } from '@/domain/time/restaurantTime';
import { OrderMode, MODE_META, PAYMENT_METHODS, paymentLabel } from './shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// ─── Payment Sheet ────────────────────────────────────────────────────────────
export default function PaymentSheet({ cart, menuItems, sym, cartTotalWithTax, taxAmount, taxDisplay, taxRate,
  orderMode, displayName, scheduledDate, scheduledTime, timezone, notes, loading,
  customerName, customerPhone, deliveryAddress, customerInfoValid,
  onNotes, onCustomerName, onCustomerPhone, onDeliveryAddress, onClose, onPay,
}: {
  cart: CartItem[]; menuItems: MenuItem[]; sym: string;
  cartTotalWithTax: number; taxAmount: number; taxDisplay: string; taxRate: number;
  orderMode: OrderMode; displayName: string;
  scheduledDate: string; scheduledTime: string; timezone: string;
  notes: string; loading: boolean;
  customerName: string; customerPhone: string; deliveryAddress: string;
  customerInfoValid: boolean;
  onNotes: (n: string) => void;
  onCustomerName: (v: string) => void;
  onCustomerPhone: (v: string) => void;
  onDeliveryAddress: (v: string) => void;
  onClose: () => void;
  onPay: (method: PaymentMethod) => void;
}) {
  useEscapeKey(onClose);
  const [selected, setSelected] = useState<PaymentMethod>(PAYMENT_METHODS[0].id);
  const inputCls = 'w-full h-10 px-3.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors';
  const availableMethods = PAYMENT_METHODS;
  const selectedMethod = availableMethods.find(p => p.id === selected) ?? availableMethods[0];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="max-w-lg mx-auto p-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-lg font-bold">Payment</h2>
              {orderMode !== 'dine-in' && (
                <p className="text-xs text-muted-foreground mt-0.5">{MODE_META[orderMode].subtitle}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-5 h-5" /></button>
          </div>

          {/* Order summary */}
          <div className="glass-card p-4 mb-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Order summary · {displayName}
            </p>
            {cart.map(ci => {
              const item = menuItems.find(m => m.id === ci.menuItemId);
              if (!item) return null;
              const modExtra = ci.selectedModifiers.reduce((s, sel) => {
                const mod = item.modifiers.find(m => m.id === sel.modifierId);
                const opt = mod?.options.find(o => o.id === sel.optionId);
                return s + (opt?.priceAdjustment ?? 0);
              }, 0);
              return (
                <div key={`${ci.menuItemId}-${JSON.stringify(ci.selectedModifiers)}`} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{item.icon} {ci.quantity}× {item.name}</span>
                  <span className="font-medium">{sym}{((item.price + modExtra) * ci.quantity).toFixed(2)}</span>
                </div>
              );
            })}
            {taxDisplay === 'exclusive' && taxAmount > 0 && (
              <div className="flex justify-between text-sm pt-1 border-t border-border">
                <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                <span>{sym}{taxAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
              <span>Total</span><span>{sym}{cartTotalWithTax.toFixed(2)}</span>
            </div>
          </div>

          {/* Scheduled time — takeaway & delivery */}
          {orderMode !== 'dine-in' && scheduledDate && scheduledTime && (
            <div className="mb-5 p-4 rounded-2xl bg-primary/5 border border-primary/20 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                {orderMode === 'takeaway' ? <Package className="w-4 h-4 text-primary" /> : <Bike className="w-4 h-4 text-primary" />}
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {orderMode === 'takeaway' ? 'Pickup time' : 'Delivery time'}
                </p>
                <p className="text-sm font-bold text-primary mt-0.5">
                  {formatScheduled(scheduledDate, scheduledTime, timezone)}
                </p>
              </div>
            </div>
          )}

          {/* Customer info — takeaway & delivery only */}
          {orderMode !== 'dine-in' && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your Details</p>
              <div className="space-y-2.5">
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={customerName} onChange={e => onCustomerName(e.target.value)}
                    placeholder="Full name *"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={customerPhone} onChange={e => onCustomerPhone(e.target.value)}
                    placeholder="Phone number *" type="tel"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                {orderMode === 'delivery' && (
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                    <textarea
                      value={deliveryAddress} onChange={e => onDeliveryAddress(e.target.value)}
                      placeholder="Delivery address *" rows={2}
                      className="w-full px-3.5 pl-9 py-2.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors resize-none"
                    />
                  </div>
                )}
              </div>
              {!customerInfoValid && (
                <p className="text-xs text-destructive mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Please fill in all required fields above
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes (optional)</p>
          <textarea
            value={notes} onChange={e => onNotes(e.target.value)}
            placeholder="Allergies, special requests…"
            rows={2}
            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors resize-none mb-5"
          />

          {/* Payment method selector */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Payment method</p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {availableMethods.map(({ id, icon: Icon }) => {
              const displayLabel = paymentLabel(orderMode);
              const isSelected = selected === id;
              return (
                <button
                  key={id}
                  onClick={() => setSelected(id)}
                  disabled={loading}
                  className={`flex items-center gap-2.5 p-3.5 rounded-xl border text-sm font-medium transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/8 text-primary shadow-sm'
                      : 'border-border bg-muted/30 text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-primary' : ''}`} />
                  <span className="text-left leading-tight flex-1">{displayLabel}</span>
                  {isSelected && (
                    <span className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-3 h-3 text-primary-foreground" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Pay button */}
          <button
            onClick={() => onPay(selected)}
            disabled={loading || !customerInfoValid}
            className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                Processing…
              </>
            ) : (
              <>
                <selectedMethod.icon className="w-4 h-4" />
                Place order · {paymentLabel(orderMode)} · {sym}{cartTotalWithTax.toFixed(2)}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
