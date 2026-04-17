/**
 * OrderPortal — public food ordering entry point.
 * Accessed via /order/:restaurantToken
 *
 * Customers choose how they want to order:
 *   • Dine In   — guided to scan the QR code at their table
 *   • Takeaway  — simple pickup request (name, phone, time, notes)
 *   • Delivery  — delivery request (name, phone, address, time, notes)
 *
 * Takeaway and delivery requests are stored as CalendarEvents
 * (type='takeaway' / type='delivery') so managers see them in the
 * Calendar / bookings view alongside reservations.
 *
 * For the full in-table food-ordering flow, customers scan the QR on their
 * table which leads to /menu?t={tableId}.
 */
import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  UtensilsCrossed, ShoppingBag, Bike, ChefHat, ArrowLeft, CheckCircle,
  QrCode, Clock, Phone, MessageSquare, MapPin,
} from 'lucide-react';
import { fetchRestaurantByToken, submitBookingToSupabase } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { CalendarEvent } from '@/domain/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'dine-in' | 'takeaway' | 'delivery';

interface PortalData {
  restaurantName: string;
  restaurantToken: string;
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderPortal() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [data, setData]         = useState<PortalData | null>(null);
  const [mode, setMode]         = useState<Mode | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    name: '', phone: '', date: today(), time: '12:00',
    notes: '', address: '',
  });

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid link.'); setLoading(false); return; }
    (async () => {
      try {
        let res = await fetchRestaurantByToken(restaurantToken);
        if (!res) {
          // Supabase may be configured but this token only exists locally (demo / dev).
          // Always try the local store as fallback.
          const state = useStore.getState();
          if (state.settings?.restaurantToken === restaurantToken) {
            res = { userId: state.user?.id ?? '', settings: state.settings, menuItems: state.menuItems, tables: state.tables };
          }
        }
        if (!res) { setError('Restaurant not found.'); setLoading(false); return; }

        const storeState = useStore.getState();
        const isLocal = !isSupabaseEnabled() || storeState.settings?.restaurantToken === restaurantToken;

        setData({
          restaurantName:  res.settings?.businessName ?? 'SmartLine',
          restaurantToken: restaurantToken,
          submitRequest: async (eventData) => {
            if (isLocal) { storeState.addCalendarEvent(eventData); return true; }
            return (await submitBookingToSupabase(restaurantToken, eventData)).ok;
          },
        });
      } catch {
        setError('Failed to load this page.');
      } finally {
        setLoading(false);
      }
    })();
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

  const showBack = mode !== null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {showBack ? (
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
              {!mode ? 'How would you like to order?' : mode === 'dine-in' ? 'Dine In' : mode === 'takeaway' ? 'Takeaway' : 'Delivery'}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* ── Mode selector ── */}
        {!mode && (
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
                <p className="text-sm text-muted-foreground mt-0.5">Scan the QR at your table to order</p>
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
                <p className="text-sm text-muted-foreground mt-0.5">Place a pickup order in advance</p>
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

        {/* ── Dine In: scan instructions ── */}
        {mode === 'dine-in' && (
          <div className="glass-card p-8 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <QrCode className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg">Scan the QR at your table</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto">
                Each table has a unique QR code that opens the menu and lets you order directly from your phone.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/50 text-sm text-muted-foreground">
              Can't find the QR code? Ask a member of staff and they'll help you get started.
            </div>
          </div>
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
                <label className="text-xs text-muted-foreground font-medium mb-1 block"><Phone className="w-3 h-3 inline mr-0.5" />Phone *</label>
                <input type="tel" required value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="input-field w-full" placeholder="+1 234 567 890" />
              </div>

              {mode === 'delivery' && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block"><MapPin className="w-3 h-3 inline mr-0.5" />Delivery address *</label>
                  <input type="text" required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="input-field w-full" placeholder="Street, city, postcode" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">
                    <Clock className="w-3 h-3 inline mr-0.5" />
                    {mode === 'takeaway' ? 'Pickup date' : 'Delivery date'}
                  </label>
                  <input type="date" min={today()} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">
                    {mode === 'takeaway' ? 'Pickup time' : 'Delivery time'}
                  </label>
                  <select value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} className="input-field w-full">
                    {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block"><MessageSquare className="w-3 h-3 inline mr-0.5" />Order notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} className="input-field w-full resize-none"
                  placeholder={mode === 'takeaway'
                    ? 'What you\'d like, dietary requirements, allergies…'
                    : 'What you\'d like, dietary requirements, gate code…'} />
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
