/**
 * BookingPage — public event booking page.
 * Accessed via /book/:restaurantToken
 *
 * Flow:
 *   1. Event packages (if any configured) → pick or skip
 *   2. Calendar — pick available date
 *   3. Time slot
 *   4. Contact & details form
 *   5. Confirmation + status lookup
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Clock, Users, CheckCircle, ChefHat,
  Phone, Mail, MessageSquare, Search, X,
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

function normalizePhone(p: string) { return p.replace(/[\s\-().+]/g, ''); }

function StatusBadge({ status }: { status: string }) {
  if (status === 'approved') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30 px-2 py-0.5 rounded-full">
      ✓ Confirmed
    </span>
  );
  if (status === 'declined') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
      ✗ Declined
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30 px-2 py-0.5 rounded-full">
      ⏳ Pending
    </span>
  );
}

// ─── Data interface ────────────────────────────────────────────────────────────

type LeanEvent = Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'> & {
  customerPhone?: string;
  customerName?: string;
};

interface BookingData {
  restaurantName: string;
  calendarSettings: CalendarSettings;
  eventPackages: EventPackage[];
  calendarEvents: LeanEvent[];
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

  // ── Status lookup state ────────────────────────────────────────────────────
  const [showLookup, setShowLookup]       = useState(false);
  const [lookupPhone, setLookupPhone]     = useState('');
  const [lookupResults, setLookupResults] = useState<LeanEvent[] | null>(null);

  // Live calendarEvents from the store — updated by the cross-tab storage listener
  // when admin approves / rejects in another tab.
  const storeCalendarEvents = useStore(s => s.calendarEvents);

  // Auto-refresh an open lookup when admin changes a status in another tab.
  useEffect(() => {
    if (lookupPhone.trim() && lookupResults !== null) {
      const merged = storeCalendarEvents.length
        ? (storeCalendarEvents as LeanEvent[])
        : (data?.calendarEvents ?? []);
      runLookup(lookupPhone, merged);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeCalendarEvents]);

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid booking link.'); setLoading(false); return; }
    (async () => {
      try {
        let res = await fetchRestaurantByToken(restaurantToken);
        if (!res) {
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
        let calEvents: LeanEvent[];

        if (isLocal) {
          calSettings = storeState.calendarSettings;
          evtPackages = storeState.eventPackages.filter(p => p.active);
          calEvents   = storeState.calendarEvents.map(e => ({
            id: e.id, date: e.date, timeSlot: e.timeSlot, type: e.type,
            status: e.status, customerPhone: e.customerPhone, customerName: e.customerName,
          }));
        } else {
          const bd = await fetchBookingDataByToken(restaurantToken);
          const def: CalendarSettings = {
            maxEventsPerDay: 10, requireApproval: true, advanceBookingDays: 90,
            bookingMessage: '',
            workingDays: [
              { dayOfWeek: 1, isOpen: true,  openTime: '09:00', closeTime: '22:00' },
              { dayOfWeek: 2, isOpen: true,  openTime: '09:00', closeTime: '22:00' },
              { dayOfWeek: 3, isOpen: true,  openTime: '09:00', closeTime: '22:00' },
              { dayOfWeek: 4, isOpen: true,  openTime: '09:00', closeTime: '22:00' },
              { dayOfWeek: 5, isOpen: true,  openTime: '09:00', closeTime: '23:00' },
              { dayOfWeek: 6, isOpen: true,  openTime: '10:00', closeTime: '23:00' },
              { dayOfWeek: 0, isOpen: false, openTime: '10:00', closeTime: '20:00' },
            ],
            workingExceptions: [], shiftTemplates: [], weekTemplate: [],
          };
          const raw = bd?.calendarSettings;
          calSettings = (raw && raw.workingDays?.length) ? raw : def;
          evtPackages = bd?.eventPackages ?? [];
          calEvents   = (bd?.calendarEvents ?? []).map((e: LeanEvent) => ({
            id: e.id, date: e.date, timeSlot: e.timeSlot, type: e.type,
            status: e.status, customerPhone: e.customerPhone, customerName: e.customerName,
          }));
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

  // ── Lookup ─────────────────────────────────────────────────────────────────

  function runLookup(phone: string, fallbackEvents?: LeanEvent[]) {
    const n = normalizePhone(phone.trim());
    if (!n) { setLookupResults([]); return; }
    // Prefer live store data (updated by cross-tab sync) over the mount-time snapshot
    const events = (storeCalendarEvents.length ? storeCalendarEvents as LeanEvent[] : null)
      ?? fallbackEvents
      ?? data?.calendarEvents
      ?? [];
    setLookupResults(
      events.filter(e => normalizePhone(e.customerPhone ?? '') === n)
             .sort((a, b) => b.date.localeCompare(a.date))
    );
  }

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
    if (ok) {
      // Append to local list so the lookup finds it immediately
      const newEvent: LeanEvent = {
        id: crypto.randomUUID(),
        date: selectedDate, timeSlot: selectedSlot,
        type: form.packageId ? 'private_event' : 'reservation',
        status,
        customerPhone: form.phone.trim(),
        customerName:  form.name.trim(),
      };
      const updatedEvents = [...data.calendarEvents, newEvent];
      setData(d => d ? { ...d, calendarEvents: updatedEvents } : d);

      // Pre-fill and run lookup with their phone
      if (form.phone.trim()) {
        const lp = form.phone.trim();
        setLookupPhone(lp);
        runLookup(lp, updatedEvents);
      }
      setSubmitted(true);
    }
  }

  function reset() {
    setStep(data?.eventPackages.length ? 'packages' : 'date');
    setSelectedDate(null); setSelectedSlot(null);
    setForm({ name: '', phone: '', email: '', guests: 2, packageId: '', notes: '' });
    setSubmitted(false);
    setLookupPhone('');
    setLookupResults(null);
  }

  // ── Shared header ──────────────────────────────────────────────────────────

  const PageHeader = () => (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
          <ChefHat className="w-4 h-4 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-sm leading-tight truncate">{data?.restaurantName ?? ''}</p>
          <p className="text-[11px] text-muted-foreground">Private event booking</p>
        </div>
        <button
          onClick={() => { setShowLookup(true); setLookupResults(null); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 underline underline-offset-2"
        >
          Check status
        </button>
      </div>
    </header>
  );

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
    const submittedStatus = needs ? 'pending' : 'approved';
    return (
      <div className="min-h-screen bg-background">
        <PageHeader />
        <div className="max-w-lg mx-auto px-4 py-10 space-y-5">

          {/* Success header */}
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="font-display text-2xl font-bold">Request received!</h1>
            <p className="text-muted-foreground mt-2 max-w-sm mx-auto text-sm">
              {needs
                ? "Your event request has been sent. We'll be in touch to confirm the details."
                : `Your event on ${new Date(selectedDate! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at ${selectedSlot} is confirmed!`}
            </p>
          </div>

          {/* This request */}
          <div className="glass-card p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {new Date(selectedDate! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{selectedSlot} · {form.guests} guests</p>
            </div>
            <StatusBadge status={submittedStatus} />
          </div>

          {/* Phone lookup panel */}
          <div className="glass-card p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Check your requests</p>
            <form
              onSubmit={e => { e.preventDefault(); runLookup(lookupPhone, data.calendarEvents); }}
              className="flex gap-2"
            >
              <input
                type="tel"
                value={lookupPhone}
                onChange={e => setLookupPhone(e.target.value)}
                className="input-field flex-1 text-sm"
                placeholder="Your phone number"
              />
              <button type="submit" className="btn-primary px-3 shrink-0">
                <Search className="w-4 h-4" />
              </button>
            </form>
            {lookupResults !== null && (
              lookupResults.length === 0 ? (
                <p className="text-xs text-muted-foreground">No requests found for this number.</p>
              ) : (
                <div className="space-y-2">
                  {lookupResults.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/50">
                      <div className="text-xs">
                        <p className="font-medium">
                          {new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        <p className="text-muted-foreground">{r.timeSlot}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  ))}
                </div>
              )
            )}
          </div>

          <button onClick={reset} className="btn-ghost text-sm w-full">Make another request</button>
        </div>

        <LookupModal data={data} showLookup={showLookup} setShowLookup={setShowLookup} runLookup={runLookup} lookupPhone={lookupPhone} setLookupPhone={setLookupPhone} lookupResults={lookupResults} setLookupResults={setLookupResults} onNewRequest={() => { setShowLookup(false); reset(); }} />
      </div>
    );
  }

  const selectedPkg = data.eventPackages.find(p => p.id === form.packageId);

  return (
    <div className="min-h-screen bg-background">

      <PageHeader />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

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
                    ? "Your request will be reviewed and confirmed by our team. We'll be in touch shortly."
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

      <LookupModal data={data} showLookup={showLookup} setShowLookup={setShowLookup} runLookup={runLookup} lookupPhone={lookupPhone} setLookupPhone={setLookupPhone} lookupResults={lookupResults} setLookupResults={setLookupResults} onNewRequest={() => setShowLookup(false)} />
    </div>
  );
}

// ─── Lookup modal ─────────────────────────────────────────────────────────────

interface LookupModalProps {
  data: BookingData;
  showLookup: boolean;
  setShowLookup: (v: boolean) => void;
  runLookup: (phone: string, events: LeanEvent[]) => void;
  lookupPhone: string;
  setLookupPhone: (v: string) => void;
  lookupResults: LeanEvent[] | null;
  setLookupResults: (v: LeanEvent[] | null) => void;
  onNewRequest: () => void;
}

function LookupModal({ data, showLookup, setShowLookup, runLookup, lookupPhone, setLookupPhone, lookupResults, setLookupResults, onNewRequest }: LookupModalProps) {
  if (!showLookup) return null;

  function close() {
    setShowLookup(false);
    setLookupResults(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="bg-card rounded-2xl w-full max-w-sm p-5 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display font-bold text-base">Check request status</h2>
          <button onClick={close} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={e => { e.preventDefault(); runLookup(lookupPhone, data.calendarEvents); }}
          className="flex gap-2 mb-4"
        >
          <input
            type="tel"
            value={lookupPhone}
            onChange={e => setLookupPhone(e.target.value)}
            className="input-field flex-1"
            placeholder="Your phone number"
            autoFocus
          />
          <button type="submit" className="btn-primary px-3 shrink-0">
            <Search className="w-4 h-4" />
          </button>
        </form>

        {lookupResults !== null && (
          lookupResults.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No requests found for this number.</p>
          ) : (
            <div className="space-y-2 mb-2">
              {lookupResults.map(r => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                  <div className="text-sm">
                    <p className="font-medium">
                      {new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-muted-foreground text-xs">{r.timeSlot}</p>
                  </div>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </div>
          )
        )}

        <button onClick={onNewRequest} className="btn-ghost text-sm w-full mt-3">
          Make a new request →
        </button>
      </div>
    </div>
  );
}
