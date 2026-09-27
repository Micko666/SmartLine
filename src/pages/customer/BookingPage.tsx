/**
 * BookingPage — public event booking page.
 * Accessed via /book/:restaurantToken
 *
 * Flow:
 *   1. Event packages (if any configured) → pick or skip
 *   2. Calendar — pick available date (restaurant timezone)
 *   3. Time slot
 *   4. Contact & details form
 *   5. Confirmation code + status lookup (phone + code)
 *
 * The server decides the booking status and validates the request; this page
 * only mirrors the rules for UX (src/domain/booking/policy.ts).
 */
import { useState, useMemo, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Clock, Users, CheckCircle, ChefHat,
  Phone, Mail, MessageSquare, Search, X,
} from 'lucide-react';
import type { CalendarEvent } from '@/domain/types';
import { bookingPolicy, bookingSlots, isBookableDate } from '@/domain/booking/policy';
import { restaurantDate } from '@/domain/time/restaurantTime';
import {
  loadBookingContext, lookupBooking, submitBooking,
  type BookingContext, type BookingLookupRow,
} from '@/services/bookingService';
import { useEscapeKey } from '@/hooks/useEscapeKey';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function longDate(date: string, weekday: 'long' | 'short' = 'long') {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday, month: weekday === 'long' ? 'long' : 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00Z`));
}

const STATUS_BADGE: Record<CalendarEvent['status'], { label: string; cls: string }> = {
  approved:  { label: '✓ Confirmed', cls: 'text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30' },
  pending:   { label: '⏳ Pending',  cls: 'text-amber-700 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30' },
  rejected:  { label: '✗ Declined',  cls: 'text-destructive bg-destructive/10' },
  cancelled: { label: '✗ Cancelled', cls: 'text-muted-foreground bg-muted' },
  completed: { label: '✓ Completed', cls: 'text-muted-foreground bg-muted' },
};

export function StatusBadge({ status }: { status: CalendarEvent['status'] }) {
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>;
}

type Step = 'packages' | 'date' | 'time' | 'form';

interface Submitted { status: CalendarEvent['status']; confirmationCode: string; date: string; slot: string; guests: number }

// ─── Component ────────────────────────────────────────────────────────────────

export default function BookingPage() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [data, setData]               = useState<BookingContext | null>(null);
  const [submitted, setSubmitted]     = useState<Submitted | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const [submitError, setSubmitError] = useState('');
  const requestId = useRef(crypto.randomUUID());

  const [step, setStep]               = useState<Step>('packages');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '', phone: '', email: '', guests: 2, packageId: '', notes: '',
  });

  // ── Status lookup state (phone + confirmation code) ────────────────────────
  const [showLookup, setShowLookup]       = useState(false);
  const [lookupPhone, setLookupPhone]     = useState('');
  const [lookupCode, setLookupCode]       = useState('');
  const [lookupResults, setLookupResults] = useState<BookingLookupRow[] | null>(null);

  async function runLookup() {
    if (!restaurantToken) return;
    setLookupResults(await lookupBooking(restaurantToken, lookupPhone.trim(), lookupCode.trim()));
  }

  // ── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid booking link.'); setLoading(false); return; }
    loadBookingContext(restaurantToken)
      .then(ctx => {
        if (!ctx) { setError('Restaurant not found.'); return; }
        setData(ctx);
        if (ctx.eventPackages.length === 0) setStep('date');
      })
      .catch(() => setError('Failed to load booking page.'))
      .finally(() => setLoading(false));
  }, [restaurantToken]);

  const policy   = useMemo(() => bookingPolicy(data?.calendarSettings), [data]);
  const timezone = data?.timezone ?? 'UTC';

  // ── Calendar helpers ───────────────────────────────────────────────────────

  const year        = currentDate.getFullYear();
  const month       = currentDate.getMonth();
  const firstDay    = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const todayStr    = restaurantDate(timezone);

  const isAvailableDay = (dateStr: string) => !!data && isBookableDate(policy, data.busySlots, dateStr, timezone);
  const timeSlots = useMemo(
    () => (selectedDate && data ? bookingSlots(policy, selectedDate, timezone) : []),
    [selectedDate, data, policy, timezone],
  );

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !restaurantToken || !selectedDate || !selectedSlot || !form.name.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError('');
    const result = await submitBooking(restaurantToken, {
      clientRequestId: requestId.current,
      date: selectedDate, timeSlot: selectedSlot,
      type: form.packageId ? 'private_event' : 'reservation',
      customerName: form.name.trim(), customerPhone: form.phone.trim(), customerEmail: form.email.trim(),
      guestCount: form.guests, packageId: form.packageId || null, notes: form.notes,
    });
    setSubmitting(false);
    if (!result.ok) { setSubmitError(result.error); return; }
    setSubmitted({ status: result.status, confirmationCode: result.confirmationCode, date: selectedDate, slot: selectedSlot, guests: form.guests });
    setLookupPhone(form.phone.trim());
    setLookupCode(result.confirmationCode);
    requestId.current = crypto.randomUUID();
  }

  function reset() {
    setStep(data?.eventPackages.length ? 'packages' : 'date');
    setSelectedDate(null); setSelectedSlot(null);
    setForm({ name: '', phone: '', email: '', guests: 2, packageId: '', notes: '' });
    setSubmitted(null);
    setSubmitError('');
    setLookupPhone(''); setLookupCode('');
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

  const lookupForm = (
    <form onSubmit={e => { e.preventDefault(); void runLookup(); }} className="space-y-2">
      <input type="tel" value={lookupPhone} onChange={e => setLookupPhone(e.target.value)}
        className="input-field w-full text-sm" placeholder="Your phone number" aria-label="Phone number" />
      <div className="flex gap-2">
        <input value={lookupCode} onChange={e => setLookupCode(e.target.value.toUpperCase())} maxLength={8}
          className="input-field flex-1 text-sm font-mono" placeholder="Confirmation code" aria-label="Confirmation code" />
        <button type="submit" className="btn-primary px-3 shrink-0" aria-label="Look up"><Search className="w-4 h-4" /></button>
      </div>
    </form>
  );

  const lookupList = lookupResults !== null && (
    lookupResults.length === 0 ? (
      <p className="text-xs text-muted-foreground">No booking found for this phone number and code.</p>
    ) : (
      <div className="space-y-2">
        {lookupResults.map(r => (
          <div key={r.confirmationCode + r.date} className="flex items-center justify-between p-2.5 rounded-xl bg-muted/50">
            <div className="text-xs">
              <p className="font-medium">{longDate(r.date, 'short')}</p>
              <p className="text-muted-foreground">{r.timeSlot}</p>
            </div>
            <StatusBadge status={r.status} />
          </div>
        ))}
      </div>
    )
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
    const pending = submitted.status === 'pending';
    return (
      <div className="min-h-screen bg-background">
        <PageHeader />
        <div className="max-w-lg mx-auto px-4 py-10 space-y-5">
          <div className="text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-400" />
            </div>
            <h1 className="font-display text-2xl font-bold">Request received!</h1>
            <p className="text-muted-foreground mt-2 max-w-sm mx-auto text-sm">
              {pending
                ? "Your event request has been sent. We'll be in touch to confirm the details."
                : `Your event on ${longDate(submitted.date)} at ${submitted.slot} is confirmed!`}
            </p>
          </div>

          <div className="glass-card p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">{longDate(submitted.date)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{submitted.slot} · {submitted.guests} guests</p>
            </div>
            <StatusBadge status={submitted.status} />
          </div>

          <div className="glass-card p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Your confirmation code</p>
            <p className="font-mono text-2xl font-bold tracking-widest mt-1" data-testid="confirmation-code">{submitted.confirmationCode}</p>
            <p className="text-xs text-muted-foreground mt-1">Keep it — you need it with your phone number to check the status.</p>
          </div>

          <div className="glass-card p-4 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Check your request</p>
            {lookupForm}
            {lookupList}
          </div>

          <button onClick={reset} className="btn-ghost text-sm w-full">Make another request</button>
        </div>
        {showLookup && <LookupModal onClose={() => { setShowLookup(false); setLookupResults(null); }} form={lookupForm} list={lookupList} onNewRequest={() => { setShowLookup(false); reset(); }} />}
      </div>
    );
  }

  const selectedPkg = data.eventPackages.find(p => p.id === form.packageId);

  return (
    <div className="min-h-screen bg-background">
      <PageHeader />

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {policy.bookingMessage && (
          <p className="text-sm text-muted-foreground text-center">{policy.bookingMessage}</p>
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
                onClick={() => { setForm(f => ({ ...f, packageId: pkg.id, guests: Math.min(Math.max(f.guests, pkg.minGuests), pkg.maxGuests) })); setStep('date'); }}
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
                <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Previous month">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-sm">{MONTH_NAMES[month]} {year}</span>
                <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Next month">
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
                    <button key={day} disabled={!available} data-date={ds}
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
              <p className="text-sm font-medium">{longDate(selectedDate)}</p>
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
              <span className="font-medium text-foreground">{longDate(selectedDate, 'short')}</span>
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
                <label htmlFor="booking-name" className="text-xs text-muted-foreground font-medium mb-1 block">Full name *</label>
                <input id="booking-name" type="text" required maxLength={120} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input-field w-full" placeholder="Your name" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="booking-phone" className="text-xs text-muted-foreground font-medium mb-1 block"><Phone className="w-3 h-3 inline mr-0.5" />Phone *</label>
                  <input id="booking-phone" type="tel" required maxLength={40} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="input-field w-full" placeholder="+382 67 123 456" />
                </div>
                <div>
                  <label htmlFor="booking-email" className="text-xs text-muted-foreground font-medium mb-1 block"><Mail className="w-3 h-3 inline mr-0.5" />Email</label>
                  <input id="booking-email" type="email" maxLength={200} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="input-field w-full" placeholder="you@example.com" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Number of guests</label>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setForm(f => ({ ...f, guests: Math.max(selectedPkg?.minGuests ?? 1, f.guests - 1) }))}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors">−</button>
                  <span className="text-lg font-bold w-8 text-center">{form.guests}</span>
                  <button type="button" onClick={() => setForm(f => ({ ...f, guests: Math.min(selectedPkg?.maxGuests ?? 500, f.guests + 1) }))}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors">+</button>
                  <span className="text-sm text-muted-foreground"><Users className="w-3.5 h-3.5 inline" /> guests</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block"><MessageSquare className="w-3 h-3 inline mr-0.5" />Special requests</label>
                <textarea value={form.notes} maxLength={2000} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3} className="input-field w-full resize-none"
                  placeholder="Dietary needs, decorations, special setup, occasion details…" />
              </div>
              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-3">
                  {policy.requireApproval
                    ? "Your request will be reviewed and confirmed by our team. We'll be in touch shortly."
                    : 'Your event booking will be confirmed immediately.'}
                </p>
                {submitError && <p role="alert" className="text-sm text-destructive mb-3">{submitError}</p>}
                <button type="submit" disabled={submitting} className="btn-primary w-full text-base py-3 disabled:opacity-50">
                  {submitting ? 'Sending…' : 'Send event request'}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>

      {showLookup && <LookupModal onClose={() => { setShowLookup(false); setLookupResults(null); }} form={lookupForm} list={lookupList} onNewRequest={() => setShowLookup(false)} />}
    </div>
  );
}

// ─── Lookup modal ─────────────────────────────────────────────────────────────

function LookupModal({ onClose, form, list, onNewRequest }: {
  onClose: () => void;
  form: React.ReactNode;
  list: React.ReactNode;
  onNewRequest: () => void;
}) {
  useEscapeKey(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl w-full max-w-sm p-5 shadow-xl space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-base">Check request status</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {form}
        {list}
        <button onClick={onNewRequest} className="btn-ghost text-sm w-full">Make a new request →</button>
      </div>
    </div>
  );
}
