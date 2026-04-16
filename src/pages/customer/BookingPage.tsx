/**
 * BookingPage — public customer-facing reservation page.
 * Accessed via /book/:restaurantToken
 *
 * Shows:
 *  - Restaurant name + booking message
 *  - Month calendar with working days highlighted; closed days greyed out
 *  - On day select: available time slots
 *  - Booking form: name, phone, email, guests, package, notes
 *  - Submits as CalendarEvent with status=pending (or approved if requireApproval=false)
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, Users, CheckCircle, ChefHat } from 'lucide-react';
import { fetchRestaurantByToken, fetchBookingDataByToken, submitBookingToSupabase } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { CalendarSettings, EventPackage, WorkingDay, CalendarEvent } from '@/domain/types';

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

// ─── Component ────────────────────────────────────────────────────────────────

interface RestaurantData {
  restaurantName: string;
  calendarSettings: CalendarSettings;
  eventPackages: EventPackage[];
  calendarEvents: Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[];
  /** restaurantToken — needed for Supabase RPC path */
  restaurantToken: string;
  /** submitBooking returns true on success */
  submitBooking: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => Promise<boolean>;
}

export default function BookingPage() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [data, setData]       = useState<RestaurantData | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Step state
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '', phone: '', email: '', guests: 2, packageId: '', notes: '',
  });

  // ── Load restaurant data ───────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid booking link.'); setLoading(false); return; }

    (async () => {
      try {
        let res = await fetchRestaurantByToken(restaurantToken);

        // Local fallback for demo/dev
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
          // Demo / local mode — read straight from store
          calSettings = storeState.calendarSettings;
          evtPackages = storeState.eventPackages.filter(p => p.active);
          calEvents   = storeState.calendarEvents.map(e => ({
            id: e.id, date: e.date, timeSlot: e.timeSlot, type: e.type, status: e.status,
          }));
        } else {
          // Supabase mode — fetch public booking data via RPC
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
          restaurantToken:  restaurantToken,
          submitBooking: async (eventData) => {
            if (isLocal) {
              storeState.addCalendarEvent(eventData);
              return true;
            } else {
              const result = await submitBookingToSupabase(restaurantToken, eventData);
              return result.ok;
            }
          },
        });
      } catch {
        setError('Failed to load booking page. Please try again.');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantToken]);

  // ── Calendar helpers ────────────────────────────────────────────────────────

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const todayStr = today();

  function isAvailableDay(dateStr: string): boolean {
    if (!data) return false;
    const { calendarSettings } = data;

    // Must not be in the past
    if (dateStr < todayStr) return false;

    // Advance booking limit
    if (calendarSettings.advanceBookingDays > 0) {
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + calendarSettings.advanceBookingDays);
      if (dateStr > isoDate(maxDate)) return false;
    }

    const d = new Date(dateStr);
    const dow = d.getDay() as WorkingDay['dayOfWeek'];

    // Check exceptions first
    const exception = calendarSettings.workingExceptions.find(ex => ex.date === dateStr);
    if (exception) {
      if (exception.isClosed) return false;
      return true;
    }

    // Weekly schedule
    const wd = calendarSettings.workingDays.find(w => w.dayOfWeek === dow);
    if (!wd?.isOpen) return false;

    // Capacity check
    if (calendarSettings.maxEventsPerDay > 0) {
      const eventsOnDay = data.calendarEvents.filter(
        e => e.date === dateStr && (e.status === 'approved' || e.status === 'pending'),
      ).length;
      if (eventsOnDay >= calendarSettings.maxEventsPerDay) return false;
    }

    // Block days that have a closure event
    const hasClosure = data.calendarEvents.some(e => e.date === dateStr && e.type === 'closure' && e.status === 'approved');
    if (hasClosure) return false;

    return true;
  }

  const timeSlots = useMemo(() => {
    if (!selectedDate || !data) return [];
    const { calendarSettings } = data;
    const d = new Date(selectedDate);
    const dow = d.getDay() as WorkingDay['dayOfWeek'];
    const exception = calendarSettings.workingExceptions.find(ex => ex.date === selectedDate);
    const open  = exception?.openTime  ?? calendarSettings.workingDays.find(w => w.dayOfWeek === dow)?.openTime  ?? '09:00';
    const close = exception?.closeTime ?? calendarSettings.workingDays.find(w => w.dayOfWeek === dow)?.closeTime ?? '22:00';
    return buildTimeSlots(open, close);
  }, [selectedDate, data]);

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!data || !selectedDate || !selectedSlot) return;
    if (!form.name.trim()) return;

    const pkg = data.eventPackages.find(p => p.id === form.packageId);
    const status = data.calendarSettings.requireApproval ? 'pending' : 'approved';

    const ok = await data.submitBooking({
      date:          selectedDate,
      timeSlot:      selectedSlot,
      type:          form.packageId ? 'private_event' : 'reservation',
      status,
      customerName:  form.name.trim(),
      customerPhone: form.phone.trim(),
      customerEmail: form.email.trim(),
      guestCount:    form.guests,
      packageId:     form.packageId || undefined,
      packageName:   pkg?.name,
      notes:         form.notes,
      createdBy:     'customer',
    });

    if (ok) setSubmitted(true);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
    const status = data.calendarSettings.requireApproval ? 'pending' : 'confirmed';
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-5 text-center px-4 bg-background">
        <div className="w-16 h-16 rounded-2xl bg-success/10 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-success" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold">Request received!</h1>
          {status === 'pending' ? (
            <p className="text-muted-foreground mt-2 max-w-sm">
              Your booking request has been sent. The restaurant will confirm shortly — you'll be contacted at {form.phone || form.email || 'the details you provided'}.
            </p>
          ) : (
            <p className="text-muted-foreground mt-2 max-w-sm">
              Your reservation for {new Date(selectedDate! + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} at {selectedSlot} is confirmed!
            </p>
          )}
        </div>
        <button
          onClick={() => {
            setSubmitted(false);
            setSelectedDate(null);
            setSelectedSlot(null);
            setForm({ name: '', phone: '', email: '', guests: 2, packageId: '', notes: '' });
          }}
          className="btn-ghost"
        >
          Make another booking
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <p className="font-display font-bold text-sm leading-tight">{data.restaurantName}</p>
            <p className="text-[11px] text-muted-foreground">Make a reservation</p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">

        {/* Booking message */}
        {data.calendarSettings.bookingMessage && (
          <p className="text-sm text-muted-foreground text-center px-2">{data.calendarSettings.bookingMessage}</p>
        )}

        {/* Step 1 — Pick a date */}
        <div className="glass-card p-5">
          <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">1. Choose a date</h2>

          {/* Month nav */}
          <div className="flex items-center justify-between mb-3">
            <button
              onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold text-sm">{MONTH_NAMES[month]} {year}</span>
            <button
              onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
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
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const available  = isAvailableDay(dateStr);
              const isSelected = dateStr === selectedDate;
              const isToday    = dateStr === todayStr;

              return (
                <button
                  key={day}
                  disabled={!available}
                  onClick={() => { setSelectedDate(dateStr); setSelectedSlot(null); }}
                  className={`
                    h-10 rounded-xl text-sm font-medium transition-all
                    ${isSelected ? 'bg-primary text-primary-foreground' : ''}
                    ${!isSelected && available ? 'hover:bg-muted text-foreground' : ''}
                    ${!available ? 'text-muted-foreground/30 cursor-not-allowed' : ''}
                    ${isToday && !isSelected ? 'ring-1 ring-primary' : ''}
                  `}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2 — Pick a time */}
        {selectedDate && (
          <div className="glass-card p-5">
            <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">2. Choose a time</h2>
            <p className="text-sm font-medium mb-3">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            {timeSlots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No time slots available for this date.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {timeSlots.map(slot => (
                  <button
                    key={slot}
                    onClick={() => setSelectedSlot(slot)}
                    className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                      selectedSlot === slot
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:border-primary hover:text-primary'
                    }`}
                  >
                    <Clock className="w-3 h-3 inline mr-1" />{slot}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3 — Fill form */}
        {selectedDate && selectedSlot && (
          <div className="glass-card p-5">
            <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">3. Your details</h2>
            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Full name *</label>
                <input
                  type="text" value={form.name} required
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="input-field w-full"
                  placeholder="Your name"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Phone</label>
                  <input
                    type="tel" value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="input-field w-full"
                    placeholder="+1 234 567 890"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Email</label>
                  <input
                    type="email" value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="input-field w-full"
                    placeholder="you@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Number of guests</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, guests: Math.max(1, f.guests - 1) }))}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors"
                  >−</button>
                  <span className="text-lg font-bold w-8 text-center">{form.guests}</span>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, guests: f.guests + 1 }))}
                    className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center font-bold hover:bg-muted/80 transition-colors"
                  >+</button>
                  <span className="text-sm text-muted-foreground ml-1"><Users className="w-3.5 h-3.5 inline" /> guests</span>
                </div>
              </div>

              {data.eventPackages.length > 0 && (
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Event type (optional)</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, packageId: '' }))}
                      className={`p-3 rounded-xl border text-left transition-all ${!form.packageId ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                    >
                      <p className="text-sm font-medium">Regular visit</p>
                      <p className="text-xs text-muted-foreground">Standard reservation</p>
                    </button>
                    {data.eventPackages.map(pkg => (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, packageId: pkg.id }))}
                        className={`p-3 rounded-xl border text-left transition-all ${form.packageId === pkg.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'}`}
                      >
                        <p className="text-sm font-medium">{pkg.emoji} {pkg.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {pkg.pricePerPerson != null ? `From $${pkg.pricePerPerson}/person` : pkg.fixedPrice != null ? `$${pkg.fixedPrice}` : pkg.description || `${pkg.minGuests}–${pkg.maxGuests} guests`}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Special requests (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="input-field w-full resize-none"
                  placeholder="Dietary requirements, allergies, special setup…"
                />
              </div>

              <div className="pt-1">
                <p className="text-xs text-muted-foreground mb-3">
                  {data.calendarSettings.requireApproval
                    ? 'Your request will be reviewed and confirmed by the restaurant.'
                    : 'Your reservation will be confirmed immediately.'}
                </p>
                <button type="submit" className="btn-primary w-full text-base py-3">
                  Submit booking request
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
