/**
 * OrderPortal — public food ordering entry point.
 * Accessed via /order/:restaurantToken
 *
 * Three flows:
 *   • Dine In   — customer picks an available table → redirected to full menu (/menu?t=…&r=…)
 *   • Takeaway  — name, phone, date, time, notes
 *   • Delivery  — name, phone, address, date, time, notes
 *
 * When orderingPaused is true in settings, all flows are blocked and a
 * custom manager-written message is shown instead.
 *
 * Loading strategy: try localStorage first (zero latency for local/demo mode).
 * Supabase fetch happens in parallel; if the local store has a matching token
 * we never block the UI waiting for the network.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  UtensilsCrossed, ShoppingBag, Bike, ChefHat, ArrowLeft, CheckCircle,
  Clock, Phone, MessageSquare, MapPin, Users, PauseCircle, Calendar,
} from 'lucide-react';
import { fetchRestaurantByToken, submitBookingToSupabase } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { CalendarEvent, Table, BusinessSettings } from '@/domain/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'dine-in' | 'takeaway' | 'delivery';

interface PortalData {
  restaurantName: string;
  restaurantToken: string;
  settings: BusinessSettings;
  tables: Table[];
  submitRequest: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<boolean>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today() { return new Date().toISOString().slice(0, 10); }

function buildTimes(): string[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return times;
}

const TIME_OPTIONS = buildTimes();

// ─── Sub-screens ──────────────────────────────────────────────────────────────

/** Shown when the manager has paused online ordering. */
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

/** Dine-in: customer picks a free table, then we navigate to the full menu. */
function TablePicker({ tables, token, onBack }: { tables: Table[]; token: string; onBack: () => void }) {
  const navigate = useNavigate();

  // Group by zone for nicer layout
  const zones = Array.from(new Set(tables.map(t => t.zone ?? 'Dining Room'))).sort();

  function pickTable(tableId: string) {
    navigate(`/menu?t=${encodeURIComponent(tableId)}&r=${encodeURIComponent(token)}`);
  }

  const available = tables.filter(t => t.status === 'available');
  const occupied  = tables.filter(t => t.status !== 'available');

  return (
    <div className="space-y-5 pb-8">
      <div className="glass-card p-5">
        <p className="text-sm text-muted-foreground">
          {available.length > 0
            ? `${available.length} table${available.length !== 1 ? 's' : ''} available — tap one to open the menu.`
            : 'All tables are currently occupied. Please ask a member of staff.'}
        </p>
      </div>

      {zones.map(zone => {
        const zoneTables = tables.filter(t => (t.zone ?? 'Dining Room') === zone);
        return (
          <div key={zone}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-2">{zone}</p>
            <div className="grid grid-cols-2 gap-3">
              {zoneTables.map(table => {
                const free = table.status === 'available';
                return (
                  <button
                    key={table.id}
                    disabled={!free}
                    onClick={() => pickTable(table.id)}
                    className={`glass-card p-4 text-left transition-all ${free
                      ? 'hover:shadow-md hover:scale-[1.02] active:scale-[0.98]'
                      : 'opacity-50 cursor-not-allowed'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{table.name}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        free ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                      }`}>
                        {free ? 'Free' : 'Occupied'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="w-3 h-3" />
                      <span>Up to {table.capacity}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {occupied.length > 0 && available.length === 0 && (
        <div className="glass-card p-4 text-center text-sm text-muted-foreground">
          All {tables.length} tables occupied. Ask a member of staff for assistance.
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function OrderPortal() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [data, setData]           = useState<PortalData | null>(null);
  const [mode, setMode]           = useState<Mode | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    name: '', phone: '', date: today(), time: '12:00',
    notes: '', address: '',
  });

  // ── Build portal data from a restaurant fetch result ──────────────────────

  const buildPortalData = useCallback((
    res: { userId: string; settings: BusinessSettings; tables: Table[] },
    token: string,
    isLocal: boolean,
  ): PortalData => {
    const storeState = useStore.getState();
    return {
      restaurantName:  res.settings?.businessName ?? 'SmartLine',
      restaurantToken: token,
      settings:        res.settings,
      tables:          res.tables ?? [],
      submitRequest: async (eventData) => {
        if (isLocal) { storeState.addCalendarEvent(eventData); return true; }
        return (await submitBookingToSupabase(token, eventData)).ok;
      },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load — local-first, then Supabase in background ───────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid link.'); setLoading(false); return; }

    // 1. Try localStorage immediately (zero-latency for demo / self-hosted)
    const storeState = useStore.getState();
    if (storeState.settings?.restaurantToken === restaurantToken) {
      setData(buildPortalData(
        { userId: storeState.user?.id ?? '', settings: storeState.settings, tables: storeState.tables },
        restaurantToken,
        true,
      ));
      setLoading(false);

      // Refresh from Supabase in background if available (fresher stock/settings)
      if (isSupabaseEnabled()) {
        fetchRestaurantByToken(restaurantToken)
          .then(fresh => {
            if (fresh) {
              setData(buildPortalData(
                { userId: fresh.userId, settings: fresh.settings, tables: fresh.tables },
                restaurantToken,
                false,
              ));
            }
          })
          .catch(() => { /* non-critical */ });
      }
      return;
    }

    // 2. No local match — must fetch from Supabase (real deployment, customer device)
    (async () => {
      try {
        const res = await fetchRestaurantByToken(restaurantToken);
        if (!res) { setError('Restaurant not found.'); setLoading(false); return; }
        setData(buildPortalData(
          { userId: res.userId, settings: res.settings, tables: res.tables },
          restaurantToken,
          false,
        ));
      } catch {
        setError('Failed to load this page. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantToken]);

  // ── Submit (takeaway / delivery) ───────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !mode || mode === 'dine-in') return;
    if (!form.name.trim() || !form.phone.trim()) return;

    const notes = mode === 'delivery' && form.address.trim()
      ? `Delivery to: ${form.address.trim()}${form.notes ? ' — ' + form.notes : ''}`
      : form.notes;

    const ok = await data.submitRequest({
      date:          form.date,
      timeSlot:      form.time,
      type:          mode === 'takeaway' ? 'takeaway' : 'delivery',
      status:        'pending',
      customerName:  form.name.trim(),
      customerPhone: form.phone.trim(),
      customerEmail: '',
      guestCount:    1,
      notes,
      createdBy:     'customer',
    });

    if (ok) setSubmitted(true);
  }

  // ── Screens ────────────────────────────────────────────────────────────────

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

  // Paused ordering — show custom message
  if (data.settings?.orderingPaused) {
    return <ClosedScreen name={data.restaurantName} message={data.settings.orderingPausedMessage} />;
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 text-center px-4 bg-background">
        <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-success" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">
            {mode === 'takeaway' ? 'Pickup order received!' : 'Delivery request received!'}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-sm text-sm">
            The restaurant will confirm your order shortly. Keep your phone nearby — we'll contact you at {form.phone}.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {mode === 'takeaway' ? 'Pickup' : 'Delivery'}: {form.date} at {form.time}
          </p>
        </div>
        <button
          onClick={() => { setMode(null); setSubmitted(false); setForm({ name: '', phone: '', date: today(), time: '12:00', notes: '', address: '' }); }}
          className="btn-ghost text-sm"
        >
          Place another order
        </button>
      </div>
    );
  }

  const isToday = form.date === today();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {mode !== null ? (
            <button onClick={() => setMode(null)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0">
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
              {mode === null     ? 'How would you like to order?' :
               mode === 'dine-in' ? 'Pick your table' :
               mode === 'takeaway' ? 'Takeaway order' : 'Delivery order'}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Mode selector ── */}
        {mode === null && (
          <div className="grid grid-cols-1 gap-3">
            {/* Dine In */}
            <button
              onClick={() => setMode('dine-in')}
              className="glass-card p-5 text-left hover:shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                <UtensilsCrossed className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-base">Dine In</p>
                <p className="text-sm text-muted-foreground mt-0.5">Pick a table and order from the menu</p>
              </div>
            </button>

            {/* Takeaway */}
            <button
              onClick={() => setMode('takeaway')}
              className="glass-card p-5 text-left hover:shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <p className="font-semibold text-base">Takeaway</p>
                <p className="text-sm text-muted-foreground mt-0.5">Order for pickup — today or a future date</p>
              </div>
            </button>

            {/* Delivery */}
            <button
              onClick={() => setMode('delivery')}
              className="glass-card p-5 text-left hover:shadow-md transition-all hover:scale-[1.01] active:scale-[0.99] flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                <Bike className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="font-semibold text-base">Delivery</p>
                <p className="text-sm text-muted-foreground mt-0.5">We'll bring your order to your door</p>
              </div>
            </button>
          </div>
        )}

        {/* ── Dine In: table picker ── */}
        {mode === 'dine-in' && (
          <TablePicker
            tables={data.tables}
            token={data.restaurantToken}
            onBack={() => setMode(null)}
          />
        )}

        {/* ── Takeaway / Delivery form ── */}
        {(mode === 'takeaway' || mode === 'delivery') && (
          <div className="glass-card p-5">
            <h2 className="font-display font-semibold mb-4 text-base">
              {mode === 'takeaway' ? 'Pickup details' : 'Delivery details'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Your name *</label>
                <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input-field w-full" placeholder="Full name" />
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">
                  <Phone className="w-3 h-3 inline mr-0.5" />Phone *
                </label>
                <input type="tel" required value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="input-field w-full" placeholder="+1 234 567 890" />
              </div>

              {mode === 'delivery' && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">
                    <MapPin className="w-3 h-3 inline mr-0.5" />Delivery address *
                  </label>
                  <input type="text" required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="input-field w-full" placeholder="Street, city, postcode" />
                </div>
              )}

              {/* Date & time — allow future dates prominently */}
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">
                  <Calendar className="w-3 h-3 inline mr-0.5" />
                  {mode === 'takeaway' ? 'Pickup date & time' : 'Delivery date & time'}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    min={today()}
                    value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="input-field w-full"
                  />
                  <select
                    value={form.time}
                    onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                    className="input-field w-full"
                  >
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {!isToday && (
                  <p className="text-xs text-primary mt-1.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Advance order — the restaurant will confirm availability.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">
                  <MessageSquare className="w-3 h-3 inline mr-0.5" />
                  What would you like? / Notes (optional)
                </label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={4}
                  className="input-field w-full resize-none"
                  placeholder={mode === 'takeaway'
                    ? 'List items, quantities, dietary requirements, allergies…\ne.g. 2x Margherita, 1x Caesar Salad, no anchovies'
                    : 'List items, quantities, dietary requirements, gate code…'}
                />
              </div>

              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-3">
                  The restaurant will review and confirm your order. They'll contact you at the number above.
                </p>
                <button type="submit" className="btn-primary w-full text-base py-3">
                  {mode === 'takeaway' ? 'Request pickup order' : 'Request delivery'}
                </button>
              </div>

            </form>
          </div>
        )}

      </div>
    </div>
  );
}
