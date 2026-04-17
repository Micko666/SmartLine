/**
 * BookingPage — public customer-facing booking page.
 * Accessed via /book/:restaurantToken
 *
 * Flow:
 *   1. Mode selector: Dine In / Takeaway / Delivery / Plan an Event
 *   2. (Event only) Package picker
 *   3. Date picker (calendar)
 *   4. Time slot picker
 *   5. Contact & details form
 *   6. Confirmation screen
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Clock, Users, CheckCircle, ChefHat,
  UtensilsCrossed, ShoppingBag, Bike, Star, ArrowLeft,
} from 'lucide-react';
import { fetchRestaurantByToken, fetchBookingDataByToken, submitBookingToSupabase } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { CalendarSettings, CalendarEventType, EventPackage, WorkingDay, CalendarEvent } from '@/domain/types';

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceMode = 'dine-in' | 'takeaway' | 'delivery' | 'event';
type Step = 'mode' | 'packages' | 'date' | 'time' | 'form';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function today() { return isoDate(new Date()); }

function buildTimeSlots(openTime: string, closeTime: string, slotMinutes = 60): string[] {
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const slots: string[] = [];
  let cur = oh * 60 + om;
  const end = ch * 60 + cm - slotMinutes;
  while (cur <= end) {
    slots.push(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
    cur += slotMinutes;
  }
  return slots;
}

const MODE_CONFIG: Record<ServiceMode, {
  label: string;
  subtitle: string;
  icon: React.FC<{ className?: string }>;
  color: string;
  eventType: CalendarEventType;
}> = {
  'dine-in':  { label: 'Dine In',        subtitle: 'Reserve a table',           icon: UtensilsCrossed, color: 'text-primary',     eventType: 'reservation'    },
  'takeaway': { label: 'Takeaway',        subtitle: 'Pick up your order',         icon: ShoppingBag,     color: 'text-orange-500',   eventType: 'takeaway'       },
  'delivery': { label: 'Delivery',        subtitle: 'We bring it to you',         icon: Bike,            color: 'text-blue-500',     eventType: 'delivery'       },
  'event':    { label: 'Plan an Event',   subtitle: 'Birthdays, parties & more',  icon: Star,            color: 'text-purple-500',   eventType: 'private_event'  },
};

// ─── Shared data interface ────────────────────────────────────────────────────

interface RestaurantData {
  restaurantName: string;
  calendarSettings: CalendarSettings;
  eventPackages: EventPackage[];
  calendarEvents: Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[];
  submitBooking: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<boolean>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [data, setData]       = useState<RestaurantData | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Flow state
  const [mode, setMode]                 = useState<ServiceMode | null>(null);
  const [step, setStep]                 = useState<Step>('mode');
  const [currentDate, setCurrentDate]   = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '', phone: '', email: '', guests: 2,
    packageId: '', notes: '', address: '',
  });

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid booking link.'); setLoading(false); return; }
    (async () => {
      try {
        let res = await fetchRestaurantByToken(restaurantToken);
        if (!res && !isSupabaseEnabled()) {
          const state = useStore.getState();
          if (state.settings?.restaurantToken === restaurantToken) {
            res = { userId: state.user?.id ?? '', settings: state.settings, menuItems: state.menuItems, tables: state.tables };
          }
        }
        if (!res) { setError('Restaurant not found.'); setLoading(false); return; }

        const storeState = useStore.getState();
        const isLocal = !isSupabaseEnabled() || storeState.settings?.restaurantToken === restaurantToken;

        let calSettings: CalendarSettings;
        let evtPackages: EventPackage[];
        let calEvents: Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[];

        if (isLocal) {
          calSettings = storeState.calendarSettings;
          evtPackages = storeState.eventPackages.filter(p => p.active);
          calEvents   = storeState.calendarEvents.map(e => ({ id: e.id, date: e.date, timeSlot: e.timeSlot, type: e.type, status: e.status }));
        } else {
          const bookingData = await fetchBookingDataByToken(restaurantToken);
          const defaultSettings: CalendarSettings = {
            maxEventsPerDay: 10, requireApproval: true, advanceBookingDays: 90,
            bookingMessage: '', workingDays: [], workingExceptions: [],
          };
          calSettings = bookingData?.calendarSettings ?? defaultSettings;
          evtPackages = bookingData?.eventPackages ?? [];
          calEvents   = bookingData?.calendarEvents ?? [];
        }

        setData({
          restaurantName:   res.settings?.businessName ?? 'SmartLine',
          calendarSettings: calSettings,
          eventPackages:    evtPackages,
          calendarEvents:   calEvents,
          submitBooking: async (eventData) => {
            if (isLocal) { storeState.addCalendarEvent(eventData); return true; }
            return (await submitBookingToSupabase(restaurantToken, eventData)).ok;
          },
        });
      } catch {
        setError('Failed to load booking page.');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantToken]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr    = today();

  function isAvailableDay(dateStr: string): boolean {
    if (!data || dateStr < todayStr) return false;
    const { calendarSettings: cs } = data;
    if (cs.advanceBookingDays > 0) {
      const max = new Date(); max.setDate(max.getDate() + cs.advanceBookingDays);
      if (dateStr > isoDate(max)) return false;
    }
    const d   = new Date(dateStr);
    const dow = d.getDay() as WorkingDay['dayOfWeek'];
    const exc = cs.workingExceptions.find(ex => ex.date === dateStr);
    if (exc) return !exc.isClosed;
    if (!cs.workingDays.find(w => w.dayOfWeek === dow)?.isOpen) return false;
    if (cs.maxEventsPerDay > 0) {
      const count = data.calendarEvents.filter(e => e.date === dateStr && (e.status === 'approved' || e.status === 'pending')).length;
      if (count >= cs.maxEventsPerDay) return false;
    }
    return !data.calendarEvents.some(e => e.date === dateStr && e.type === 'closure' && e.status === 'approved');
  }

  const timeSlots = useMemo(() => {
    if (!selectedDate || !data) return [];
    const { calendarSettings: cs } = data;
    const d   = new Date(selectedDate);
    const dow = d.getDay() as WorkingDay['dayOfWeek'];
    const exc = cs.workingExceptions.find(ex => ex.date === selectedDate);
    const open  = exc?.openTime  ?? cs.workingDays.find(w => w.dayOfWeek === dow)?.openTime  ?? '09:00';
    const close = exc?.closeTime ?? cs.workingDays.find(w => w.dayOfWeek === dow)?.closeTime ?? '22:00';
    return buildTimeSlots(open, close);
  }, [selectedDate, data]);

  // ── Navigation ─────────────────────────────────────────────────────────────

  function selectMode(m: ServiceMode) {
    setMode(m);
    // Events go to package selection first (if packages exist), then date
    if (m === 'event' && data && data.eventPackages.length > 0) {
      setStep('packages');
    } else {
      setStep('date');
    }
  }

  function goBack() {
    if (step === 'packages') { setMode(null); setStep('mode'); }
    else if (step === 'date') {
      if (mode === 'event' && data && data.eventPackages.length > 0) setStep('packages');
      else { setMode(null); setStep('mode'); }
    }
    else if (step === 'time') { setSelectedDate(null); setStep('date'); }
    else if (step === 'form') { setSelectedSlot(null); setStep('time'); }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !selectedDate || !selectedSlot || !mode) return;
    if (!form.name.trim()) return;

    const cfg    = MODE_CONFIG[mode];
    const pkg    = data.eventPackages.find(p => p.id === form.packageId);
    const status = data.calendarSettings.requireApproval ? 'pending' : 'approved';

    const deliveryNote = mode === 'delivery' && form.address.trim()
      ? `Delivery to: ${form.address.trim()}${form.notes ? ' — ' + form.notes : ''}`
      : form.notes;

    const ok = await data.submitBooking({
      date:          selectedDate,
      timeSlot:      selectedSlot,
      type:          cfg.eventType,
      status,
      customerName:  form.name.trim(),
      customerPhone: form.phone.trim(),
      customerEmail: form.email.trim(),
      guestCount:    form.guests,
      packageId:     form.packageId || undefined,
      packageName:   pkg?.name,
      notes:         deliveryNote,
      createdBy:     'customer',
    });

    if (ok) setSubmitted(true);
  }

  function resetFlow() {
    setMode(null); setStep('mode');
    setSelectedDate(null); setSelectedSlot(null);
    setForm({ name: '', phone: '', email: '', guests: 2, packageId: '', notes: '', address: '' });
    setSubmitted(false);
  }

  // ── Loading / error screens ────────────────────────────────────────────────

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
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <span className="text-3xl">⚠️</span>
        </div>
        <p className="text-foreground font-semibold text-lg">{error || 'Booking page unavailable'}</p>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────

  if (submitted && mode) {
    const cfg    = MODE_CONFIG[mode];
    const needs  = data.calendarSettings.requireApproval;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 text-center px-4 bg-background">
        <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-success" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">
            {mode === 'delivery' ? 'Order placed!' : mode === 'takeaway' ? 'Order received!' : 'Request received!'}
          </h1>
          {needs ? (
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Your {cfg.label.toLowerCase()} request has been sent.
              {' '}The restaurant will confirm shortly.
            </p>
          ) : (
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Your {cfg.label.toLowerCase()} for{' '}
              {new Date(selectedDate! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}{' '}
              at {selectedSlot} is confirmed.
            </p>
          )}
        </div>
        <button onClick={resetFlow} className="btn-ghost text-sm">
          Make another request
        </button>
      </div>
    );
  }

  // ── Shared header ──────────────────────────────────────────────────────────

  const showBack = step !== 'mode';

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {showBack ? (
            <button onClick={goBack} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0">
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
              {step === 'mode'     && 'How can we help?'}
              {step === 'packages' && 'Choose your event type'}
              {step === 'date'     && (mode ? MODE_CONFIG[mode].label : 'Choose a date')}
              {step === 'time'     && 'Choose a time'}
              {step === 'form'     && 'Your details'}
            </p>
          </div>
          {mode && step !== 'mode' && (
            <div className={`text-xs font-semibold px-2.5 py-1 rounded-full bg-muted ${MODE_CONFIG[mode].color}`}>
              {MODE_CONFIG[mode].label}
            </div>
          )}
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {data.calendarSettings.bookingMessage && step === 'mode' && (
          <p className="text-sm text-muted-foreground text-center px-2">{data.calendarSettings.bookingMessage}</p>
        )}

        {/* ── STEP: Mode selector ── */}
        {step === 'mode' && (
          <div className="grid grid-cols-2 gap-3">
            {(Object.entries(MODE_CONFIG) as [ServiceMode, typeof MODE_CONFIG[ServiceMode]][]).map(([key, cfg]) => {
              const Icon = cfg.icon;
              // Hide event mode if no packages configured
              if (key === 'event' && data.eventPackages.length === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => selectMode(key)}
                  className="glass-card p-5 text-left hover:shadow-md transition-all hover:scale-[1.02] active:scale-[0.99] group"
                >
                  <div className={`w-10 h-10 rounded-xl bg-muted flex items-center justify-center mb-3 ${cfg.color} group-hover:scale-110 transition-transform`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="font-semibold text-sm text-foreground">{cfg.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{cfg.subtitle}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── STEP: Package selector (event mode) ── */}
        {step === 'packages' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Choose an event type, or continue without a package.</p>
            <div className="space-y-3">
              <button
                onClick={() => { setForm(f => ({ ...f, packageId: '' })); setStep('date'); }}
                className={`w-full p-4 rounded-2xl border text-left transition-all ${!form.packageId ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/50'}`}
              >
                <p className="font-semibold text-sm">Custom / no package</p>
                <p className="text-xs text-muted-foreground mt-0.5">I'll describe what I need in the notes</p>
              </button>
              {data.eventPackages.map(pkg => (
                <button
                  key={pkg.id}
                  onClick={() => { setForm(f => ({ ...f, packageId: pkg.id })); setStep('date'); }}
                  className={`w-full p-4 rounded-2xl border text-left transition-all ${form.packageId === pkg.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border bg-card hover:border-primary/50'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0">{pkg.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{pkg.name}</p>
                      {pkg.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{pkg.description}</p>}
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                        <span><Users className="w-3 h-3 inline mr-0.5" />{pkg.minGuests}–{pkg.maxGuests} guests</span>
                        <span><Clock className="w-3 h-3 inline mr-0.5" />{pkg.duration}h</span>
                        {pkg.pricePerPerson != null && <span className="font-semibold text-foreground">From ${pkg.pricePerPerson}/person</span>}
                        {pkg.fixedPrice     != null && <span className="font-semibold text-foreground">${pkg.fixedPrice}</span>}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── STEP: Date picker ── */}
        {step === 'date' && (
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="font-semibold text-sm">{MONTH_NAMES[month]} {year}</span>
              <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DAY_NAMES.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: firstDay }).map((_, i) => <div key={`b${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const ds        = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const available = isAvailableDay(ds);
                const isToday   = ds === todayStr;
                const selected  = ds === selectedDate;
                return (
                  <button
                    key={day}
                    disabled={!available}
                    onClick={() => { setSelectedDate(ds); setStep('time'); }}
                    className={`
                      h-10 rounded-xl text-sm font-medium transition-all
                      ${selected  ? 'bg-primary text-primary-foreground' : ''}
                      ${!selected && available ? 'hover:bg-muted text-foreground' : ''}
                      ${!available ? 'text-muted-foreground/30 cursor-not-allowed' : ''}
                      ${isToday && !selected ? 'ring-1 ring-primary' : ''}
                    `}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── STEP: Time slot ── */}
        {step === 'time' && selectedDate && (
          <div className="glass-card p-5">
            <p className="text-sm font-medium mb-4">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            {timeSlots.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm text-muted-foreground">No time slots available for this date.</p>
                <button onClick={goBack} className="btn-ghost text-sm mt-3">Choose another date</button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map(slot => (
                  <button
                    key={slot}
                    onClick={() => { setSelectedSlot(slot); setStep('form'); }}
                    className="py-2.5 rounded-xl text-sm font-medium border border-border hover:border-primary hover:text-primary hover:bg-primary/5 transition-all"
                  >
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP: Details form ── */}
        {step === 'form' && selectedDate && selectedSlot && mode && (
          <div className="glass-card p-5">
            {/* Summary bar */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 mb-5 text-xs">
              <span className="font-medium text-foreground">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-muted-foreground">at</span>
              <span className="font-medium text-foreground">{selectedSlot}</span>
              {form.packageId && data.eventPackages.find(p => p.id === form.packageId) && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-medium text-foreground">{data.eventPackages.find(p => p.id === form.packageId)!.emoji} {data.eventPackages.find(p => p.id === form.packageId)!.name}</span>
                </>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Full name *</label>
                <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input-field w-full" placeholder="Your name" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="input-field w-full" placeholder="+1 234 567 890" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="input-field w-full" placeholder="you@example.com" />
                </div>
              </div>

              {/* Guest count — shown for dine-in and events */}
              {(mode === 'dine-in' || mode === 'event') && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Number of guests</label>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setForm(f => ({ ...f, guests: Math.max(1, f.guests - 1) }))}
                      className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors">−</button>
                    <span className="text-lg font-bold w-8 text-center">{form.guests}</span>
                    <button type="button" onClick={() => setForm(f => ({ ...f, guests: f.guests + 1 }))}
                      className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors">+</button>
                    <span className="text-sm text-muted-foreground ml-1"><Users className="w-3.5 h-3.5 inline" /> guests</span>
                  </div>
                </div>
              )}

              {/* Delivery address */}
              {mode === 'delivery' && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Delivery address *</label>
                  <input type="text" required value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    className="input-field w-full" placeholder="Street, city, postcode" />
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">
                  {mode === 'takeaway' || mode === 'delivery' ? 'Order notes (optional)' : 'Special requests (optional)'}
                </label>
                <textarea
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} className="input-field w-full resize-none"
                  placeholder={mode === 'takeaway' ? 'Dietary requirements, preferred pickup…' : mode === 'delivery' ? 'Dietary requirements, gate code…' : 'Dietary requirements, occasion, setup requests…'}
                />
              </div>

              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-3">
                  {data.calendarSettings.requireApproval
                    ? 'Your request will be reviewed and confirmed by the restaurant.'
                    : 'Your booking will be confirmed immediately.'}
                </p>
                <button type="submit" className="btn-primary w-full text-base py-3">
                  {mode === 'delivery' ? 'Place delivery order' : mode === 'takeaway' ? 'Place takeaway order' : 'Send booking request'}
                </button>
              </div>

            </form>
          </div>
        )}

      </div>
    </div>
  );
}
