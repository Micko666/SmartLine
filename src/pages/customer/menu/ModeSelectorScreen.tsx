import { ShoppingBag, Plus, ChefHat, Package, Bike } from 'lucide-react';
import { motion } from 'framer-motion';
import { OrderMode } from './shared';

// ─── Mode Selector Landing ────────────────────────────────────────────────────
// Shown when the customer arrives via the generic portal link (no ?t= or ?mode=).
// Lets them choose dine-in walk-in, takeaway, or delivery before seeing the menu.

export default function ModeSelectorScreen({
  businessName, logoUrl, openingHours,
  takeawayEnabled, deliveryEnabled, orderingPaused, orderingPausedMessage,
  onSelect,
}: {
  businessName: string; logoUrl: string; openingHours: string;
  takeawayEnabled: boolean; deliveryEnabled: boolean;
  orderingPaused: boolean; orderingPausedMessage: string;
  onSelect: (mode: OrderMode) => void;
}) {
  const options: { mode: OrderMode; icon: React.ElementType; title: string; desc: string; enabled: boolean }[] = [
    {
      mode:    'takeaway',
      icon:    Package,
      title:   'Takeaway',
      desc:    'Order ahead, collect at the counter',
      enabled: takeawayEnabled,
    },
    {
      mode:    'delivery',
      icon:    Bike,
      title:   'Delivery',
      desc:    'We bring it straight to your door',
      enabled: deliveryEnabled,
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-card/90 backdrop-blur-xl border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            {logoUrl
              ? <img src={logoUrl} alt="logo" className="w-full h-full rounded-xl object-cover" />
              : <ChefHat className="w-4 h-4 text-primary-foreground" />}
          </div>
          <div>
            <p className="font-display font-bold text-sm">{businessName}</p>
            {openingHours && <p className="text-[10px] text-muted-foreground">{openingHours}</p>}
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 max-w-lg mx-auto w-full">
        {orderingPaused ? (
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <ShoppingBag className="w-7 h-7 text-muted-foreground" />
            </div>
            <h1 className="font-display text-xl font-bold">Orders paused</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              {orderingPausedMessage || "We're not taking orders right now. Check back soon!"}
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="font-display text-2xl font-bold">How would you like to order?</h1>
              <p className="text-sm text-muted-foreground mt-1.5">Choose your preferred option below. For dine-in, scan your table QR code.</p>
            </div>

            <div className="w-full space-y-3">
              {options.map(({ mode, icon: Icon, title, desc, enabled }) => (
                <motion.button
                  key={mode}
                  onClick={() => enabled && onSelect(mode)}
                  whileTap={enabled ? { scale: 0.98 } : undefined}
                  className={`w-full flex items-center gap-4 p-5 rounded-2xl border text-left transition-all
                    ${enabled
                      ? 'border-border bg-card hover:border-primary/40 hover:bg-primary/3 cursor-pointer'
                      : 'border-border/50 bg-muted/30 opacity-50 cursor-not-allowed'
                    }`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${enabled ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Icon className={`w-6 h-6 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base leading-tight">{title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  {enabled && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Plus className="w-4 h-4 text-primary rotate-45" />
                    </div>
                  )}
                  {!enabled && (
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">
                      Unavailable
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
