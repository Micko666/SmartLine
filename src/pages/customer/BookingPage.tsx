/**
 * BookingPage — public event booking page.
 * Accessed via /book/:restaurantToken
 *
 * This page is exclusively for event / private-booking requests
 * (birthdays, corporate events, group dinners, etc.)
 *
 * Food ordering (dine-in / takeaway / delivery) has a separate public entry
 * point at /order/:restaurantToken.
 *
 * Flow:
 *   1. Event packages (if any configured)  → pick or skip
 *   2. Calendar — pick available date
 *   3. Time slot
 *   4. Contact & details form
 *   5. Confirmation
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Clock, Users, CheckCircle, ChefHat,
  Phone, Mail, MessageSquare,
} from 'lucide-react';
import { fetchRestaurantByToken, fetchBookingDataByToken, submitBookingToSupabase } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { CalendarSettings, EventPackage, WorkingDay, CalendarEvent } from '@/domain/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function today()           { return isoDate(new Date()); }

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

// ─── Data interface ────────────────────────────────────────────────────────────

interface BookingData {
  restaurantName: string;
  businessPhone?: string;
  businessEmail?: string;
  calendarSettings: CalendarSettings;
  eventPackages: EventPackage[];
  calendarEvents: Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[];
  submitBooking: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<boolean>;
}

type Step = 'packages' | 'date' | 'time' | 'form';

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [data, setData]               = useState<BookingData | null>(null);
  const [submitted, setSubmitted]     = useState(false);

  const [step, setStep]               = useState<Step>('packages');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', phone: '', email: '', guests: 2, packageId: '', notes: '',
  });

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid booking link.'); setLoading(false); return; }
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

        let calSettings: CalendarSettings;
        let evtPackages: EventPackage[];
        let calEvents: Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[];

        if (isLocal) {
          calSettings = storeState.calendarSettings;
          evtPackages = storeState.eventPackages.filter(p => p.active);
          calEvents   = storeState.calendarEvents.map(e => ({ id: e.id, date: e.date, timeSlot: e.timeSlot, type: e.type, status: e.status }));
        } else {
          const bd = await fetchBookingDataByToken(restaurantToken);
          const def: CalendarSettings = {
            maxEventsPerDay: 10, requireApproval: true, advanceBookingDays: 90,
            bookingMessage: '', workingDays: [], workingExceptions: [],
            shiftTemplates: [], weekTemplate: [],
          };
          calSettings = bd?.calendarSettings ?? def;
          evtPackages = bd?.eventPackages ?? [];
          calEvents   = bd?.calendarEvents ?? [];
        }

        setData({
          restaurantName:  res.settings?.businessName ?? 'SmartLine',
          calendarSettings: calSettings,
          eventPackages:    evtPackages,
          calendarEvents:   calEvents,
          submitBooking: async (eventData) => {
            if (isLocal) { storeState.addCalendarEvent(eventData); return true; }
            return (await submitBookingToSupabase(restaurantToken, eventData)).ok;
          },
        });

        // Skip package step if no packages configured
        if (evtPackages.length === 0) setStep('date');
      } catch {
        setError('Failed to load booking page.');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantToken]);

  // ── Calendar helpers ───────────────────────────────────────────────────────

  const year        = currentDate.getFullYear();
  const month       = currentDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr    = today();

  function isAvailableDay(dateStr: string): boolean {
    if (!data || dateStr < todayStr) return false;
    const cs = data.calendarSettings;
    if (cs.advanceBookingDays > 0) {
      const max = new Date(); max.setDate(max.getDate() + cs.advanceBookingDays);
      if (dateStr > isoDate(max)) return false;
    }
    const dow = new Date(dateStr).getDay() as WorkingDay['dayOfWeek'];
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
    const cs  = data.calendarSettings;
    const dow = new Date(selectedDate).getDay() as WorkingDay['dayOfWeek'];
    const exc = cs.workingExceptions.find(ex => ex.date === selectedDate);
    const open  = exc?.openTime  ?? cs.workingDays.find(w => w.dayOfWeek === dow)?.openTime  ?? '09:00';
    const close = exc?.closeTime ?? cs.workingDays.find(w => w.dayOfWeek === dow)?.closeTime ?? '22:00';
    return buildTimeSlots(open, close);
  }, [selectedDate, data]);

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !selectedDate || !selectedSlot || !form.name.trim()) return;
    const pkg    = data.eventPackages.find(p => p.id === form.packageId);
    const status = data.calendarSettings.requireApproval ? 'pending' : 'approved';
    const ok = await data.submitBooking({
      date: selectedDate, timeSlot: selectedSlot,
      type: form.packageId ? 'private_event' : 'reservation',
      status,
      customerName: form.name.trim(), customerPhone: form.phone.trim(),
      customerEmail: form.email.trim(), guestCount: form.guests,
      packageId: form.packageId || undefined, packageName: pkg?.name,
      notes: form.notes, createdBy: 'customer',
    });
    if (ok) setSubmitted(true);
  }

  function reset() {
    setStep(data?.eventPackages.length ? 'packages' : 'date');
    setSelectedDate(null); setSelectedSlot(null);
    setForm({ name: '', phone: '', email: '', guests: 2, packageId: '', notes: '' });
    setSubmitted(false);
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
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <span className="text-3xl">⚠️</span>
        </div>
        <p className="text-foreground font-semibold text-lg">{error || 'Booking page unavailable'}</p>
      </div>
    );
  }

  if (submitted) {
    const needs = data.calendarSettings.requireApproval;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 text-center px-4 bg-background">
        <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-success" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Request received!</h1>
          {needs ? (
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Your event request has been sent. The team will get back to you to confirm the details.
            </p>
          ) : (
            <p className="text-muted-foreground mt-2 max-w-sm text-sm">
              Your event on{' '}
              {new Date(selectedDate! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}{' '}
              at {selectedSlot} is confirmed!
            </p>
          )}
        </div>
        <button onClick={reset} className="btn-ghost text-sm">Make another request</button>
      </div>
    );
  }

  const selectedPkg = data.eventPackages.find(p => p.id === form.packageId);

  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-sm leading-tight truncate">{data.restaurantName}</p>
            <p className="text-[11px] text-muted-foreground">Private event booking</p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Booking message */}
        {data.calendarSettings.bookingMessage && (
          <p className="text-sm text-muted-foreground text-center">{data.calendarSettings.bookingMessage}</p>
        )}

        {/* Step indicators */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {data.eventPackages.length > 0 && (
            <>
              <span className={step === 'packages' ? 'text-primary font-semibold' : selectedPkg ? 'line-through' : ''}>Package</span>
              <span>›</span>
            </>
          )}
          <span className={step === 'date' ? 'text-primary font-semibold' : selectedDate ? 'line-through' : ''}>Date</span>
          <span>›</span>
          <span className={step === 'time' ? 'text-primary font-semibold' : selectedSlot ? 'line-through' : ''}>Time</span>
          <span>›</span>
          <span className={step === 'form' ? 'text-primary font-semibold' : ''}>Details</span>
        </div>

        {/* ── STEP: Packages ── */}
        {step === 'packages' && (
          <div className="space-y-3">
            <p className="text-sm font-semibold">What are you celebrating?</p>
            {/* No package / regular */}
            <button
              onClick={() => { setForm(f => ({ ...f, packageId: '' })); setStep('date'); }}
              className={`w-full p-4 rounded-2xl border text-left transition-all ${!form.packageId ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/50'}`}
            >
              <p className="font-semibold text-sm">Just a group booking</p>
              <p className="text-xs text-muted-foreground mt-0.5">Standard table reservation for a larger group</p>
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
                    {pkg.details && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{pkg.details}</p>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── STEP: Date ── */}
        {step === 'date' && (
          <>
            {selectedPkg && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 text-sm">
                <span className="text-xl">{selectedPkg.emoji}</span>
                <div>
                  <span className="font-semibold">{selectedPkg.name}</span>
                  {data.eventPackages.length > 0 && (
                    <button onClick={() => setStep('packages')} className="ml-2 text-xs text-primary hover:underline">change</button>
                  )}
                </div>
              </div>
            )}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-sm">{MONTH_NAMES[month]} {year}</span>
                <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 mb-1">
                {DAY_NAMES.map(d => <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstDay }).map((_, i) => <div key={`b${i}`} />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                  const ds        = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                  const available = isAvailableDay(ds);
                  const isToday   = ds === todayStr;
                  const selected  = ds === selectedDate;
                  return (
                    <button key={day} disabled={!available}
                      onClick={() => { setSelectedDate(ds); setStep('time'); }}
                      className={`
                        h-10 rounded-xl text-sm font-medium transition-all
                        ${selected    ? 'bg-primary text-primary-foreground' : ''}
                        ${!selected && available ? 'hover:bg-muted text-foreground' : ''}
                        ${!available  ? 'text-muted-foreground/30 cursor-not-allowed' : ''}
                        ${isToday && !selected ? 'ring-1 ring-primary' : ''}
                      `}
                    >{day}</button>
                  );
                })}
              </div>
            </div>
            {/* Prefer direct contact note */}
            <p className="text-xs text-muted-foreground text-center">
              Prefer to call?{' '}
              <span className="font-medium text-foreground">{data.restaurantName}</span>
              {' '}— reach out directly to arrange your event.
            </p>
          </>
        )}

        {/* ── STEP: Time ── */}
        {step === 'time' && selectedDate && (
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-medium">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <button onClick={() => { setSelectedDate(null); setStep('date'); }} className="text-xs text-primary hover:underline">change</button>
            </div>
            {timeSlots.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground">No time slots available for this date.</p>
                <button onClick={() => { setSelectedDate(null); setStep('date'); }} className="btn-ghost text-sm mt-3">Choose another date</button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map(slot => (
                  <button key={slot}
                    onClick={() => { setSelectedSlot(slot); setStep('form'); }}
                    className="py-2.5 rounded-xl text-sm font-medium border border-border hover:border-primary hover:text-primary hover:bg-primary/5 transition-all">
                    {slot}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── STEP: Form ── */}
        {step === 'form' && selectedDate && selectedSlot && (
          <div className="glass-card p-5">
            {/* Summary */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 mb-5 text-xs flex-wrap">
              <span className="font-medium text-foreground">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span className="text-muted-foreground">at</span>
              <span className="font-medium text-foreground">{selectedSlot}</span>
              {selectedPkg && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-medium text-foreground">{selectedPkg.emoji} {selectedPkg.name}</span>
                </>
              )}
              <button onClick={() => { setSelectedSlot(null); setStep('time'); }} className="ml-auto text-primary hover:underline">change</button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Full name *</label>
                <input type="text" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input-field w-full" placeholder="Your name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block"><Phone className="w-3 h-3 inline mr-0.5" />Phone</label>
                  <input type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="input-field w-full" placeholder="+1 234 567 890" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block"><Mail className="w-3 h-3 inline mr-0.5" />Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="input-field w-full" placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Number of guests</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setForm(f => ({ ...f, guests: Math.max(1, f.guests - 1) }))}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors">−</button>
                  <span className="text-lg font-bold w-8 text-center">{form.guests}</span>
                  <button type="button" onClick={() => setForm(f => ({ ...f, guests: f.guests + 1 }))}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors">+</button>
                  <span className="text-sm text-muted-foreground"><Users className="w-3.5 h-3.5 inline" /> guests</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block"><MessageSquare className="w-3 h-3 inline mr-0.5" />Special requests</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} className="input-field w-full resize-none"
                  placeholder="Dietary needs, decorations, special setup, occasion details…" />
              </div>
              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-3">
                  {data.calendarSettings.requireApproval
                    ? 'Your request will be reviewed and confirmed by our team. We\'ll be in touch shortly.'
                    : 'Your event booking will be confirmed immediately.'}
                </p>
                <button type="submit" className="btn-primary w-full text-base py-3">
                  Send event request
                </button>
              </div>
            </form>
          </div>
        )}

      </div>
    </div>
  );
}
