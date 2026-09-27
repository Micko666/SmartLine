/**
 * Public booking rules — the TypeScript mirror of SQL `submit_booking` /
 * `booking_policy` (migration 020). Supabase mode: the server decides and
 * these functions only drive the UI. Local/demo mode: these functions decide.
 * Pure: no React, no store, no I/O.
 */
import type { CalendarEvent, CalendarSettings, EventPackage, WorkingDay } from '../types';
import { addDays, minutes, restaurantClock, weekday } from '../time/restaurantTime';

export const DEFAULT_WORKING_DAYS: WorkingDay[] = [
  { dayOfWeek: 0, isOpen: false, openTime: '09:00', closeTime: '22:00' },
  { dayOfWeek: 1, isOpen: true, openTime: '09:00', closeTime: '22:00' },
  { dayOfWeek: 2, isOpen: true, openTime: '09:00', closeTime: '22:00' },
  { dayOfWeek: 3, isOpen: true, openTime: '09:00', closeTime: '22:00' },
  { dayOfWeek: 4, isOpen: true, openTime: '09:00', closeTime: '22:00' },
  { dayOfWeek: 5, isOpen: true, openTime: '09:00', closeTime: '23:00' },
  { dayOfWeek: 6, isOpen: true, openTime: '10:00', closeTime: '23:00' },
];

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  maxEventsPerDay: 10, requireApproval: true, advanceBookingDays: 90,
  bookingMessage: 'We look forward to hosting you! Fill in your details and we will confirm your reservation shortly.',
  workingDays: DEFAULT_WORKING_DAYS,
  workingExceptions: [], shiftTemplates: [], weekTemplate: [],
};

export const SLOT_MINUTES = 60;
export const MAX_GUESTS_WITHOUT_PACKAGE = 500;

export type CustomerBookingType = 'reservation' | 'private_event';
/** Minimal event shape needed for availability (the public RPC returns no PII). */
export type BusySlot = Pick<CalendarEvent, 'date' | 'timeSlot' | 'type' | 'status'>;

/** Same defaults as SQL booking_policy: empty/partial settings fall back field by field. */
export function bookingPolicy(settings: Partial<CalendarSettings> | null | undefined): CalendarSettings {
  const s = settings ?? {};
  return {
    ...DEFAULT_CALENDAR_SETTINGS,
    ...s,
    maxEventsPerDay: s.maxEventsPerDay ?? DEFAULT_CALENDAR_SETTINGS.maxEventsPerDay,
    requireApproval: s.requireApproval ?? DEFAULT_CALENDAR_SETTINGS.requireApproval,
    advanceBookingDays: s.advanceBookingDays ?? DEFAULT_CALENDAR_SETTINGS.advanceBookingDays,
    workingDays: s.workingDays?.length ? s.workingDays : DEFAULT_WORKING_DAYS,
    workingExceptions: s.workingExceptions ?? [],
  };
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/** Opening window (minutes) for a date, or null when closed. */
export function dayWindow(policy: CalendarSettings, date: string): { open: number; close: number } | null {
  const exception = policy.workingExceptions.find(e => e.date === date);
  const day = policy.workingDays.find(d => d.dayOfWeek === weekday(date));
  if (exception) {
    if (exception.isClosed) return null;
  } else if (!day?.isOpen) {
    return null;
  }
  return {
    open: minutes(exception?.openTime ?? day?.openTime ?? '09:00'),
    close: minutes(exception?.closeTime ?? day?.closeTime ?? '22:00'),
  };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 60-minute slots from opening to one hour before close; past slots removed for today. */
export function bookingSlots(policy: CalendarSettings, date: string, timezone: string, now = new Date()): string[] {
  const window = dayWindow(policy, date);
  if (!window) return [];
  const local = restaurantClock(timezone, now);
  const slots: string[] = [];
  for (let m = window.open; m <= window.close - SLOT_MINUTES; m += SLOT_MINUTES) {
    if (date === local.date && m <= local.minutes) continue;
    slots.push(hhmm(m));
  }
  return slots;
}

export function isClosureDate(events: BusySlot[], date: string): boolean {
  return events.some(e => e.date === date && e.type === 'closure' && e.status === 'approved');
}

export function bookingsOnDate(events: BusySlot[], date: string): number {
  return events.filter(e => e.date === date && e.type !== 'closure' && (e.status === 'approved' || e.status === 'pending')).length;
}

/** Whether a customer can pick this date at all (drives the calendar UI). */
export function isBookableDate(policy: CalendarSettings, events: BusySlot[], date: string, timezone: string, now = new Date()): boolean {
  const today = restaurantClock(timezone, now).date;
  if (date < today) return false;
  if (policy.advanceBookingDays > 0 && date > addDays(today, policy.advanceBookingDays)) return false;
  if (!dayWindow(policy, date)) return false;
  if (isClosureDate(events, date)) return false;
  if (policy.maxEventsPerDay > 0 && bookingsOnDate(events, date) >= policy.maxEventsPerDay) return false;
  return bookingSlots(policy, date, timezone, now).length > 0;
}

export interface BookingRequest {
  date: string;
  timeSlot: string;
  type: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  guestCount: number;
  packageId?: string | null;
  notes?: string;
}

export type BookingDecision =
  | { ok: true; status: 'pending' | 'approved'; package?: EventPackage }
  | { ok: false; error: string };

/** Full server-equivalent validation (used as the authority in local mode). */
export function decideBooking(
  req: BookingRequest,
  ctx: { settings: Partial<CalendarSettings> | null | undefined; timezone: string; packages: EventPackage[]; events: BusySlot[]; now?: Date },
): BookingDecision {
  const policy = bookingPolicy(ctx.settings);
  const now = ctx.now ?? new Date();
  if (req.type !== 'reservation' && req.type !== 'private_event') return { ok: false, error: 'Invalid booking type' };
  const name = req.customerName.trim();
  if (name.length < 1 || name.length > 120) return { ok: false, error: 'Name is required' };
  const digits = normalizePhone(req.customerPhone);
  if (digits.length < 5 || digits.length > 20 || req.customerPhone.length > 40) return { ok: false, error: 'A valid phone number is required' };
  if ((req.customerEmail ?? '').length > 200 || (req.notes ?? '').length > 2000) return { ok: false, error: 'Field too long' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(req.timeSlot)) return { ok: false, error: 'Invalid date or time' };
  if (new Date(`${req.date}T12:00:00Z`).toISOString().slice(0, 10) !== req.date) return { ok: false, error: 'Invalid date' };

  const today = restaurantClock(ctx.timezone, now).date;
  if (req.date < today) return { ok: false, error: 'Date is in the past' };
  if (policy.advanceBookingDays > 0 && req.date > addDays(today, policy.advanceBookingDays)) return { ok: false, error: 'Date is too far in advance' };
  const window = dayWindow(policy, req.date);
  if (!window) return { ok: false, error: 'Closed on this day' };
  const slot = minutes(req.timeSlot);
  if (slot < window.open || slot > window.close - SLOT_MINUTES || (slot - window.open) % SLOT_MINUTES !== 0) return { ok: false, error: 'Time is outside booking hours' };
  if (req.date === today && slot <= restaurantClock(ctx.timezone, now).minutes) return { ok: false, error: 'Time is in the past' };
  if (isClosureDate(ctx.events, req.date)) return { ok: false, error: 'Closed on this date' };
  if (policy.maxEventsPerDay > 0 && bookingsOnDate(ctx.events, req.date) >= policy.maxEventsPerDay) return { ok: false, error: 'Fully booked on this date' };

  let pkg: EventPackage | undefined;
  if (req.packageId) {
    pkg = ctx.packages.find(p => p.id === req.packageId && p.active);
    if (!pkg) return { ok: false, error: 'Package not available' };
    if (!Number.isInteger(req.guestCount) || req.guestCount < Math.max(pkg.minGuests, 1) || req.guestCount > pkg.maxGuests) {
      return { ok: false, error: 'Guest count is outside the package range' };
    }
  } else if (!Number.isInteger(req.guestCount) || req.guestCount < 1 || req.guestCount > MAX_GUESTS_WITHOUT_PACKAGE) {
    return { ok: false, error: 'Invalid guest count' };
  }
  return { ok: true, status: policy.requireApproval ? 'pending' : 'approved', package: pkg };
}

/** 8 uppercase hex characters, same format the server issues. */
export function generateConfirmationCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
