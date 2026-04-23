import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, Clock, ChefHat, ShoppingBag, Bike } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { isSupabaseEnabled } from '@/store/flags';
import type { Receipt } from '@/domain/types';

const PAYMENT_LABELS: Record<string, string> = {
  card: 'Credit / Debit Card',
  cash: 'Pay at Counter',
  google_pay: 'Google Pay',
  apple_pay: 'Apple Pay',
};

export default function CustomerReceipt() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const [searchParams] = useSearchParams();
  const restaurantToken = searchParams.get('r') ?? '';
  const tableId         = searchParams.get('t') ?? '';
  const mode            = searchParams.get('mode') ?? '';          // 'takeaway' | 'delivery' | ''
  const scheduledDate   = searchParams.get('date') ?? '';
  const scheduledTime   = searchParams.get('time') ?? '';
  const scheduledAddr   = searchParams.get('addr') ?? '';

  const { receipts, orders, settings } = useStore(useShallow(s => ({
    receipts: s.receipts,
    orders:   s.orders,
    settings: s.settings,
  })));

  const [fetchedReceipt, setFetchedReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(false);

  const storeReceipt = receipts.find(r => r.id === receiptId);
  const receipt      = storeReceipt ?? fetchedReceipt;
  const order        = receipt ? orders.find(o => o.id === receipt.orderId) : null;
  const sym          = settings.currencySymbol || '€';

  // Fetch from Supabase when receipt is not in the local store
  // (customer refreshed, came back via link, or opened on a different device)
  useEffect(() => {
    if (storeReceipt || !receiptId || !isSupabaseEnabled()) return;
    setLoading(true);
    import('@/lib/supabase/queries/receipts')
      .then(({ fetchReceiptById }) => fetchReceiptById(receiptId))
      .then(r => { setFetchedReceipt(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [receiptId, storeReceipt]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!receipt) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <ChefHat className="w-8 h-8 text-muted-foreground" />
          </div>
          <h1 className="font-display text-xl font-bold mb-2">Receipt not found</h1>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            This receipt may have expired or the link is invalid.
          </p>
        </div>
      </div>
    );
  }

  const createdAt         = new Date(receipt.createdAt);
  const estimatedPrepTime = order?.estimatedPrepTime ?? 15;
  const isScheduled       = (mode === 'takeaway' || mode === 'delivery') && !!scheduledDate && !!scheduledTime;

  // Human-readable scheduled label
  function fmtScheduled(dateStr: string, timeStr: string) {
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const dateLabel =
      dateStr === today    ? 'Today' :
      dateStr === tomorrow ? 'Tomorrow' :
      new Date(dateStr + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `${dateLabel} at ${timeStr}`;
  }

  // "Order More" — correctly reconstruct the full menu URL with all params
  // so the customer lands back on the exact same mode/schedule, not the
  // generic mode-selector (which was the old bug).
  let menuUrl: string | null = null;
  if (restaurantToken) {
    if (tableId) {
      // Dine-in: return to same table
      menuUrl = `/menu?t=${encodeURIComponent(tableId)}&r=${encodeURIComponent(restaurantToken)}`;
    } else if (mode === 'takeaway' || mode === 'delivery') {
      // Takeaway / delivery: carry the full scheduling context
      const p = new URLSearchParams({ mode, r: restaurantToken });
      if (scheduledDate) p.set('date', scheduledDate);
      if (scheduledTime) p.set('time', scheduledTime);
      if (scheduledAddr) p.set('addr', scheduledAddr);
      menuUrl = `/menu?${p.toString()}`;
    }
    // No menuUrl for receipt-only views (no table, no mode)
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card/90 backdrop-blur-xl border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-sm">{receipt.restaurantName}</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
        {/* Success banner */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center mb-2"
        >
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${
            isScheduled ? 'bg-primary/10' : 'bg-green-500/10'
          }`}>
            {isScheduled && mode === 'takeaway' ? (
              <ShoppingBag className="w-8 h-8 text-primary" />
            ) : isScheduled && mode === 'delivery' ? (
              <Bike className="w-8 h-8 text-primary" />
            ) : (
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            )}
          </div>
          <h1 className="font-display text-2xl font-bold">Order Confirmed</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isScheduled
              ? mode === 'takeaway'
                ? `Ready for pickup ${fmtScheduled(scheduledDate, scheduledTime)}`
                : `Delivery scheduled for ${fmtScheduled(scheduledDate, scheduledTime)}`
              : 'Your order is with the kitchen'}
          </p>
        </motion.div>

        {/* Order number — prominent "show to staff" badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="glass-card p-6 text-center border-2 border-primary/20"
        >
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Your order number</p>
          <p className="font-display text-7xl font-bold text-primary leading-none">#{receipt.orderNumber}</p>
          {receipt.tableName && (
            <p className="text-sm text-muted-foreground mt-2">{receipt.tableName}</p>
          )}
          <p className="text-[10px] text-muted-foreground mt-3 opacity-50">Show this to a staff member if needed</p>
        </motion.div>

        {/* Timing card — scheduled time for takeaway/delivery, wait for dine-in */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.13 }}
          className="glass-card p-4 flex items-center gap-3"
        >
          <Clock className={`w-5 h-5 shrink-0 ${isScheduled ? 'text-primary' : 'text-amber-500'}`} />
          <div>
            {isScheduled ? (
              <>
                <p className="font-semibold text-sm">
                  {mode === 'takeaway' ? 'Pickup' : 'Delivery'}: {fmtScheduled(scheduledDate, scheduledTime)}
                </p>
                {scheduledAddr && (
                  <p className="text-xs text-muted-foreground mt-0.5">{scheduledAddr}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ordered at {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-sm">~{estimatedPrepTime} min estimated wait</p>
                <p className="text-xs text-muted-foreground">
                  Placed at {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </>
            )}
          </div>
        </motion.div>

        {/* Receipt breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.18 }}
          className="glass-card overflow-hidden"
        >
          <div className="bg-primary/5 px-5 py-3 text-center border-b border-border">
            <p className="font-display font-bold text-sm">{receipt.restaurantName}</p>
            <p className="text-xs text-muted-foreground">
              {createdAt.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
              {' · '}
              {createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>

          <div className="p-5 space-y-3">
            {receipt.items.map((item, i) => (
              <div key={i} className="flex items-start justify-between text-sm">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">
                    {item.menuItemIcon} {item.quantity}× {item.menuItemName}
                  </span>
                  {item.modifiers.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.modifiers.map(m => m.optionName).join(', ')}
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground shrink-0 ml-3">
                  {sym}{item.lineTotal.toFixed(2)}
                </span>
              </div>
            ))}

            <div className="border-t border-dashed border-border pt-3 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{sym}{receipt.subtotal.toFixed(2)}</span>
              </div>
              {receipt.taxAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax ({receipt.taxRate}%)</span>
                  <span>{sym}{receipt.taxAmount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                <span>Total</span>
                <span>{sym}{receipt.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="pt-2 border-t border-border text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Payment</span>
                <span>{PAYMENT_LABELS[receipt.paymentMethod] ?? receipt.paymentMethod}</span>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Actions */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          className="space-y-2 pt-2"
        >
          {menuUrl && (
            <Link
              to={menuUrl}
              className="w-full h-12 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
            >
              Order More
            </Link>
          )}
          <p className="text-center text-xs text-muted-foreground pt-3">
            Thank you! Enjoy your meal.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
