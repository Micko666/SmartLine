/**
 * Public (unauthenticated) queries for the customer-facing menu, booking, and roster pages.
 */

import { supabase } from '../client';
import { mapMenuItemRow, mapSettingsRow, mapTableRow, mapEventPackageRow, mapEmployeeRow, mapShiftRow } from '../mappers';
import type { MenuItem, BusinessSettings, Table, CalendarSettings, EventPackage, CalendarEvent, Employee, Shift } from '@/domain/types';

export interface PublicRestaurantData {
  userId: string;
  settings: BusinessSettings;
  menuItems: MenuItem[];
  tables: Table[];
}

/**
 * Loads everything a customer menu page needs from a restaurantToken.
 * Single RPC call — no sequential round trips.
 * Returns null if the token doesn't match any restaurant.
 */
export async function fetchRestaurantByToken(
  token: string,
): Promise<PublicRestaurantData | null> {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc('get_customer_menu', {
    p_restaurant_token: token,
  });

  if (error || !data) return null;

  const result = data as {
    ok: boolean;
    userId: string;
    settings: Record<string, unknown>;
    menuItems: Record<string, unknown>[];
    tables: Record<string, unknown>[];
  };

  if (!result.ok) return null;

  return {
    userId:    result.userId,
    settings:  mapSettingsRow(result.settings),
    menuItems: (result.menuItems ?? []).map(mapMenuItemRow),
    tables:    (result.tables ?? []).map(mapTableRow),
  };
}

// ─── Booking page ─────────────────────────────────────────────────────────────

export interface PublicBookingData {
  restaurantName: string;
  timezone: string;
  calendarSettings: Partial<CalendarSettings>;
  eventPackages: EventPackage[];
  /** Availability only: no ids, no customer data. */
  busySlots: Pick<CalendarEvent, 'date' | 'timeSlot' | 'type' | 'status'>[];
}

export async function fetchBookingDataByToken(token: string): Promise<PublicBookingData | null> {
  if (!supabase || !token) return null;
  const { data, error } = await supabase.rpc('get_booking_data', { p_restaurant_token: token });
  if (error || !data) return null;
  const result = data as {
    ok: boolean; restaurantName: string; timezone: string;
    calendarSettings: Record<string, unknown>; eventPackages: Record<string, unknown>[]; calendarEvents: Record<string, unknown>[];
  };
  if (!result.ok) return null;
  // The RPC returns nulls for unset policy fields; drop them so defaults apply.
  const settings = Object.fromEntries(Object.entries(result.calendarSettings ?? {}).filter(([, v]) => v !== null)) as Partial<CalendarSettings>;
  return {
    restaurantName: result.restaurantName ?? '',
    timezone: result.timezone || 'UTC',
    calendarSettings: settings,
    eventPackages: (result.eventPackages ?? []).map(mapEventPackageRow),
    busySlots: (result.calendarEvents ?? []).map(row => ({
      date: row.date as string,
      timeSlot: row.time_slot as string,
      type: row.type as CalendarEvent['type'],
      status: row.status as CalendarEvent['status'],
    })),
  };
}

export interface BookingSubmission {
  clientRequestId: string;
  date: string;
  timeSlot: string;
  type: 'reservation' | 'private_event';
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  guestCount: number;
  packageId?: string | null;
  notes: string;
}

export type BookingSubmitResult =
  | { ok: true; eventId: string; status: CalendarEvent['status']; confirmationCode: string }
  | { ok: false; error: string };

/** The server decides status (requireApproval) and validates everything else. */
export async function submitBookingToSupabase(token: string, b: BookingSubmission): Promise<BookingSubmitResult> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };
  const { data, error } = await supabase.rpc('submit_booking', {
    p_restaurant_token: token,
    p_client_request_id: b.clientRequestId,
    p_date: b.date,
    p_time_slot: b.timeSlot,
    p_type: b.type,
    p_customer_name: b.customerName,
    p_customer_phone: b.customerPhone,
    p_customer_email: b.customerEmail,
    p_guest_count: b.guestCount,
    p_package_id: b.packageId || null,
    p_notes: b.notes,
  });
  if (error) return { ok: false, error: error.message };
  return data as BookingSubmitResult;
}

export interface BookingLookupRow {
  date: string;
  timeSlot: string;
  type: CalendarEvent['type'];
  status: CalendarEvent['status'];
  packageName?: string;
  guestCount?: number;
  confirmationCode: string;
}

export async function lookupBookingStatus(token: string, phone: string, code: string): Promise<BookingLookupRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('lookup_booking_status', {
    p_restaurant_token: token, p_phone: phone, p_confirmation_code: code,
  });
  if (error || !data) return [];
  return ((data as { bookings?: BookingLookupRow[] }).bookings ?? []);
}

// ─── Roster page ──────────────────────────────────────────────────────────────

export interface PublicRosterData {
  businessName: string;
  employees: Employee[];
  shifts: Shift[];
}

export async function fetchRosterDataByToken(
  token: string,
): Promise<PublicRosterData | null> {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc('get_roster_data', {
    p_restaurant_token: token,
  });

  if (error || !data) return null;

  const result = data as {
    ok: boolean;
    businessName: string;
    employees: Record<string, unknown>[];
    shifts: Record<string, unknown>[];
  };

  if (!result.ok) return null;

  return {
    businessName: result.businessName ?? '',
    employees:    (result.employees ?? []).map(mapEmployeeRow),
    shifts:       (result.shifts ?? []).map(mapShiftRow),
  };
}
