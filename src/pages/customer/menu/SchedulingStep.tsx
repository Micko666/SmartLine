import { useState, useEffect, useMemo } from 'react';
import { Clock, MapPin, Calendar, ArrowRight } from 'lucide-react';
import type { BusinessSettings } from '@/domain/types';
import { orderingSlots } from '@/domain/ordering/scheduling';
import { restaurantDate } from '@/domain/time/restaurantTime';

// ─── Scheduling Step ──────────────────────────────────────────────────────────
// Fallback shown when mode=takeaway/delivery but date+time not in URL.
// Normally OrderPortal sets these before navigating; this handles direct links.

export default function SchedulingStep({ orderMode, onConfirm, settings }: {
  orderMode: 'takeaway' | 'delivery';
  onConfirm: (date: string, time: string, address: string) => void;
  settings: BusinessSettings;
}) {
  const today = restaurantDate(settings.timezone);
  const [date, setDate] = useState(today);
  const [address, setAddress] = useState('');
  const slots = useMemo(() => orderingSlots(date, settings.businessHours, settings.timezone), [date, settings.businessHours, settings.timezone]);
  const [time, setTime] = useState(() => orderingSlots(today, settings.businessHours, settings.timezone)[0] ?? '12:00');

  useEffect(() => {
    setTime(prev => (slots.includes(prev) ? prev : (slots[0] ?? '12:00')));
  }, [slots]);

  const isToday = date === today;
  const noSlots = slots.length === 0;
  const canConfirm = !noSlots && time && (orderMode !== 'delivery' || address.trim().length > 0);

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors';

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
      <div className="glass-card p-5 space-y-5">
        <div>
          <h2 className="font-display font-semibold text-base">
            {orderMode === 'takeaway' ? 'When would you like to pick up?' : 'When should we deliver?'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {orderMode === 'takeaway'
              ? 'Choose your preferred time — your order will be ready at the counter.'
              : 'Choose your delivery time and enter your address.'}
          </p>
        </div>

        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Date
          </label>
          <input type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {orderMode === 'takeaway' ? 'Pickup time' : 'Delivery time'}
          </label>
          {noSlots ? (
            <div className="p-3 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground text-center">
              No slots available for today — select a future date.
            </div>
          ) : (
            <select value={time} onChange={e => setTime(e.target.value)} className={inputCls}>
              {slots.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {isToday && !noSlots && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Showing times at least 30 min from now
            </p>
          )}
        </div>

        {orderMode === 'delivery' && (
          <div>
            <label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Delivery address *
            </label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Street, city, postcode"
              className={inputCls}
            />
          </div>
        )}
      </div>

      <button
        onClick={() => canConfirm && onConfirm(date, time, address)}
        disabled={!canConfirm}
        className="w-full rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed py-4"
      >
        Continue to Menu <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
