/**
 * OrderPortal — public food ordering entry point.
 * Accessed via /order/:restaurantToken
 *
 * Two flows:
 *   • Takeaway  — pick date + time → /menu?mode=takeaway&date=…&time=…&r=…
 *   • Delivery  — pick date + time + enter address → /menu?mode=delivery&date=…&time=…&addr=…&r=…
 *
 * All menu browsing and payment happen in /menu.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ShoppingBag, Bike, ChefHat, ArrowLeft, ArrowRight,
  Clock, MapPin, PauseCircle, Calendar,
} from 'lucide-react';
import { fetchRestaurantByToken } from '@/lib/supabase/queries/public';
import { useStore, getPersistedSettings } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { BusinessSettings } from '@/domain/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'takeaway' | 'delivery';

interface PortalData {
  restaurantName: string;
  restaurantToken: string;
  settings: BusinessSettings;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }

function timeToMins(t: string) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Check if ordering is currently open given businessHours.
 * Returns { open: true } or { open: false, reason } for the closed screen.
 */
function checkOpenStatus(
  businessHours: BusinessSettings['businessHours'],
): { open: true } | { open: false; reason: string } {
  if (!businessHours?.length) return { open: true };
  const now  = new Date();
  const dow  = now.getDay() as 0|1|2|3|4|5|6;
  const day  = businessHours.find(d => d.dayOfWeek === dow);
  if (!day || !day.isOpen) {
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return { open: false, reason: `We're closed on ${names[dow]}s. Check back on our next open day.` };
  }
  const nowMins   = now.getHours() * 60 + now.getMinutes();
  const openMins  = timeToMins(day.openTime);
  const closeMins = timeToMins(day.closeTime);
  if (nowMins < openMins) {
    return { open: false, reason: `We open at ${day.openTime} today. Come back then to place your order.` };
  }
  if (nowMins >= closeMins) {
    return { open: false, reason: `We closed at ${day.closeTime} today. See you next time!` };
  }
  return { open: true };
}

/**
 * Generate 15-min time slots starting at least `bufferMinutes` from now
 * (for today). Future dates respect businessHours open/close windows.
 */
function getAvailableTimeSlots(
  date: string,
  bufferMinutes = 30,
  businessHours?: BusinessSettings['businessHours'],
): string[] {
  const isToday = date === todayStr();
  const slots: string[] = [];
  let minMins = 0;
  if (isToday) {
    const now = new Date();
    minMins = Math.ceil((now.getHours() * 60 + now.getMinutes() + bufferMinutes) / 15) * 15;
  }

  // Determine open window for this day from businessHours
  let windowOpen  = 6 * 60;
  let windowClose = 24 * 60;
  if (businessHours?.length) {
    const dow = new Date(date + 'T12:00:00').getDay() as 0|1|2|3|4|5|6;
    const day = businessHours.find(d => d.dayOfWeek === dow);
    if (!day || !day.isOpen) return [];
    windowOpen  = timeToMins(day.openTime);
    windowClose = timeToMins(day.closeTime);
  }

  for (let mins = windowOpen; mins < windowClose; mins += 15) {
    if (!isToday || mins >= minMins) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

// ─── ClosedScreen ─────────────────────────────────────────────────────────────

function ClosedScreen({ message, name }: { message: string; name: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center px-6 bg-background">
      <div className="w-20 h-20 rounded-2xl bg-muted flex items-center justify-center">
        <PauseCircle className="w-10 h-10 text-muted-foreground" />
      </div>
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold">{name}</h1>
        <p className="mt-3 text-muted-foreground leading-relaxed">
          {message || "We're not accepting online orders right now. Please check back later or ask a member of staff."}
        </p>
      </div>
    </div>
  );
}

// ─── ScheduleStep ─────────────────────────────────────────────────────────────
// Shown for takeaway / delivery. Customer picks when they want their order,
// then is navigated to the full menu where they browse, cart up, and pay
// exactly like dine-in — no separate "request" step.

function ScheduleStep({ mode, token, businessHours }: {
  mode: 'takeaway' | 'delivery';
  token: string;
  businessHours?: BusinessSettings['businessHours'];
}) {
  const navigate = useNavigate();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const [address, setAddress] = useState('');

  const slots = useMemo(() => getAvailableTimeSlots(date, 30, businessHours), [date, businessHours]);
  const [time, setTime] = useState(() => getAvailableTimeSlots(today, 30, businessHours)[0] ?? '12:00');

  // When date changes, snap time to first valid slot if current is out of range
  useEffect(() => {
    setTime(prev => (slots.includes(prev) ? prev : (slots[0] ?? '12:00')));
  }, [slots]);

  const isToday = date === today;
  const noSlots = slots.length === 0;
  const canContinue = !noSlots && time && (mode !== 'delivery' || address.trim().length > 0);

  function handleContinue() {
    if (!canContinue) return;
    const params = new URLSearchParams({ mode, r: token, date, time });
    if (address.trim()) params.set('addr', address.trim());
    navigate(`/menu?${params.toString()}`);
  }

  const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-input bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors';

  return (
    <div className="space-y-4">
      <div className="glass-card p-5 space-y-5">
        <div>
          <h2 className="font-display font-semibold text-base">
            {mode === 'takeaway' ? 'When would you like to pick up?' : 'When should we deliver?'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === 'takeaway'
              ? 'Choose your preferred date and time — your order will be ready at the counter.'
              : 'Choose when you\'d like your order delivered to your address.'}
          </p>
        </div>

        {/* Date */}
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Date
          </label>
          <input
            type="date"
            min={today}
            value={date}
            onChange={e => setDate(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Time */}
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1.5 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {mode === 'takeaway' ? 'Pickup time' : 'Delivery time'}
          </label>
          {noSlots ? (
            <div className="p-3 rounded-xl bg-muted/50 border border-border text-sm text-muted-foreground text-center">
              {isToday
                ? 'No available slots for today — please select a future date.'
                : "We're not taking orders on this day — please choose a different date."}
            </div>
          ) : (
            <select
              value={time}
              onChange={e => setTime(e.target.value)}
              className={inputCls}
            >
              {slots.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {isToday && !noSlotsToday && (
            <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              Showing times at least 30 min from now
            </p>
          )}
        </div>

        {/* Address — delivery only */}
        {mode === 'delivery' && (
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
            <p className="text-xs text-muted-foreground mt-1.5">
              Map integration coming soon — enter your full address for now.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={handleContinue}
        disabled={!canContinue}
        className="w-full rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed py-4"
      >
        Browse Menu <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function OrderPortal() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [data,    setData]    = useState<PortalData | null>(null);
  const [mode,    setMode]    = useState<Mode | null>(null);

  const buildPortalData = useCallback((
    settings: BusinessSettings,
    token: string,
  ): PortalData => ({
    restaurantName:  settings?.businessName ?? 'SmartLine',
    restaurantToken: token,
    settings,
  }), []);

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid link.'); setLoading(false); return; }

    // 1. Try localStorage first (zero-latency for demo / self-hosted).
    // Prefer getPersistedSettings() so unhydrated tabs (customer device on
    // same origin) always see the latest admin-saved toggles (e.g. takeawayEnabled).
    const storeState = useStore.getState();
    const localSettings = (!storeState._hasHydrated && !isSupabaseEnabled())
      ? (getPersistedSettings() ?? storeState.settings)
      : storeState.settings;
    if (localSettings?.restaurantToken === restaurantToken) {
      setData(buildPortalData(localSettings, restaurantToken));
      setLoading(false);

      // Refresh from Supabase in background if available
      if (isSupabaseEnabled()) {
        fetchRestaurantByToken(restaurantToken)
          .then(fresh => {
            if (fresh) setData(buildPortalData(fresh.settings, restaurantToken));
          })
          .catch(() => {});
      }
      return;
    }

    // 2. No local match — must fetch (real deployment, customer device)
    (async () => {
      try {
        const res = await fetchRestaurantByToken(restaurantToken);
        if (!res) { setError('Restaurant not found.'); setLoading(false); return; }
        setData(buildPortalData(res.settings, restaurantToken));
      } catch {
        setError('Failed to load this page. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantToken, buildPortalData]);

  // ── Loading / error ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4 bg-background">
        <span className="text-4xl">⚠️</span>
        <p className="text-foreground font-semibold text-lg">{error || 'Page unavailable'}</p>
      </div>
    );
  }

  if (data.settings?.orderingPaused) {
    return <ClosedScreen name={data.restaurantName} message={data.settings.orderingPausedMessage} />;
  }

  const openStatus = checkOpenStatus(data.settings?.businessHours);
  if (!openStatus.open) {
    return <ClosedScreen name={data.restaurantName} message={openStatus.reason} />;
  }

  const { takeawayEnabled = true, deliveryEnabled = false } = data.settings;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {mode !== null ? (
            <button
              onClick={() => setMode(null)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          ) : (
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <ChefHat className="w-4 h-4 text-primary-foreground" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-sm leading-tight truncate">{data.restaurantName}</p>
            <p className="text-[11px] text-muted-foreground">
              {mode === null       ? 'How would you like to order?' :
               mode === 'takeaway' ? 'Schedule your pickup' :
                                     'Schedule your delivery'}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* ── Mode selector ── */}
        {mode === null && (
          <div className="space-y-3">
            {/* Takeaway */}
            <button
              onClick={() => takeawayEnabled && setMode('takeaway')}
              disabled={!takeawayEnabled}
              className={`w-full glass-card p-5 text-left transition-all flex items-center gap-4 ${
                takeawayEnabled
                  ? 'hover:shadow-md hover:scale-[1.01] active:scale-[0.99]'
                  : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-6 h-6 text-orange-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-base">Takeaway</p>
                <p className="text-sm text-muted-foreground mt-0.5">Order ahead, collect at the counter</p>
              </div>
              {takeawayEnabled
                ? <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
                : <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">Unavailable</span>
              }
            </button>

            {/* Delivery */}
            <button
              onClick={() => deliveryEnabled && setMode('delivery')}
              disabled={!deliveryEnabled}
              className={`w-full glass-card p-5 text-left transition-all flex items-center gap-4 ${
                deliveryEnabled
                  ? 'hover:shadow-md hover:scale-[1.01] active:scale-[0.99]'
                  : 'opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <Bike className="w-6 h-6 text-blue-500" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-base">Delivery</p>
                <p className="text-sm text-muted-foreground mt-0.5">We'll bring your order to your door</p>
              </div>
              {deliveryEnabled
                ? <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" />
                : <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">Unavailable</span>
              }
            </button>
          </div>
        )}

        {/* ── Takeaway / Delivery: scheduling step ── */}
        {(mode === 'takeaway' || mode === 'delivery') && (
          <ScheduleStep mode={mode} token={data.restaurantToken} businessHours={data.settings?.businessHours} />
        )}

      </div>
    </div>
  );
}
