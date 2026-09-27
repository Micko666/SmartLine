/**
 * Public booking — one API for both modes.
 *  Supabase: get_booking_data / submit_booking / lookup_booking_status
 *            (server authoritative; no customer PII leaves the server).
 *  Local:    the owner's workspace in this browser, decided by the same
 *            domain rules as the server (src/domain/booking/policy.ts).
 */
import { isSupabaseEnabled } from '@/store/flags';
import { useStore } from '@/store';
import {
  fetchBookingDataByToken, lookupBookingStatus, submitBookingToSupabase,
  type BookingLookupRow, type BookingSubmission, type BookingSubmitResult, type PublicBookingData,
} from '@/lib/supabase/queries/public';
import { decideBooking, generateConfirmationCode, normalizePhone } from '@/domain/booking/policy';

export type { BookingLookupRow, BookingSubmission, BookingSubmitResult, PublicBookingData as BookingContext };

export async function loadBookingContext(token: string): Promise<PublicBookingData | null> {
  if (isSupabaseEnabled()) return fetchBookingDataByToken(token);
  const s = useStore.getState();
  if (s.settings.restaurantToken !== token) return null;
  return {
    restaurantName: s.settings.businessName,
    timezone: s.settings.timezone || 'UTC',
    calendarSettings: s.calendarSettings,
    eventPackages: s.eventPackages.filter(p => p.active),
    busySlots: s.calendarEvents.map(e => ({ date: e.date, timeSlot: e.timeSlot, type: e.type, status: e.status })),
  };
}

export async function submitBooking(token: string, booking: BookingSubmission): Promise<BookingSubmitResult> {
  if (isSupabaseEnabled()) return submitBookingToSupabase(token, booking);

  const s = useStore.getState();
  if (s.settings.restaurantToken !== token) return { ok: false, error: 'Restaurant not found' };
  const existing = s.calendarEvents.find(e => e.clientRequestId === booking.clientRequestId);
  if (existing) return { ok: true, eventId: existing.id, status: existing.status, confirmationCode: existing.confirmationCode ?? '' };

  const decision = decideBooking(booking, {
    settings: s.calendarSettings, timezone: s.settings.timezone || 'UTC',
    packages: s.eventPackages, events: s.calendarEvents,
  });
  if (!decision.ok) return decision;
  const confirmationCode = generateConfirmationCode();
  const event = s.addCalendarEvent({
    date: booking.date, timeSlot: booking.timeSlot, type: booking.type, status: decision.status,
    customerName: booking.customerName.trim(), customerPhone: booking.customerPhone.trim(),
    customerEmail: booking.customerEmail.trim(), guestCount: booking.guestCount,
    packageId: decision.package?.id, packageName: decision.package?.name, notes: booking.notes,
    createdBy: 'customer', confirmationCode, clientRequestId: booking.clientRequestId,
  });
  return { ok: true, eventId: event.id, status: event.status, confirmationCode };
}

/** Needs the phone AND the confirmation code in both modes (no enumeration). */
export async function lookupBooking(token: string, phone: string, code: string): Promise<BookingLookupRow[]> {
  if (isSupabaseEnabled()) return lookupBookingStatus(token, phone, code);
  const s = useStore.getState();
  if (s.settings.restaurantToken !== token || normalizePhone(phone).length < 5) return [];
  return s.calendarEvents
    .filter(e => e.confirmationCode && e.confirmationCode === code.trim().toUpperCase() && normalizePhone(e.customerPhone) === normalizePhone(phone))
    .map(e => ({ date: e.date, timeSlot: e.timeSlot, type: e.type, status: e.status, packageName: e.packageName, guestCount: e.guestCount, confirmationCode: e.confirmationCode! }));
}
