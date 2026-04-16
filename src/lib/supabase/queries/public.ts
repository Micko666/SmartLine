/**
 * Public (unauthenticated) queries for the customer-facing menu, booking, and roster pages.
 */

import { supabase } from '../client';
import { mapMenuItemRow, mapSettingsRow, mapTableRow, mapCalendarEventRow, mapEventPackageRow, mapEmployeeRow, mapShiftRow } from '../mappers';
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
  calendarSettings: CalendarSettings;
  eventPackages: EventPackage[];
  /** Non-sensitive slots only (id, date, time_slot, type, status) */
  calendarEvents: Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[];
}

export async function fetchBookingDataByToken(
  token: string,
): Promise<PublicBookingData | null> {
  if (!supabase || !token) return null;

  const { data, error } = await supabase.rpc('get_booking_data', {
    p_restaurant_token: token,
  });

  if (error || !data) return null;

  const result = data as {
    ok: boolean;
    calendarSettings: Record<string, unknown>;
    eventPackages: Record<string, unknown>[];
    calendarEvents: Record<string, unknown>[];
  };

  if (!result.ok) return null;

  return {
    calendarSettings: result.calendarSettings as unknown as CalendarSettings,
    eventPackages: (result.eventPackages ?? []).map(mapEventPackageRow),
    calendarEvents: (result.calendarEvents ?? []).map(row => ({
      id:        row.id as string,
      date:      row.date as string,
      timeSlot:  row.time_slot as string,
      type:      row.type as CalendarEvent['type'],
      status:    row.status as CalendarEvent['status'],
    })) as Pick<CalendarEvent, 'id' | 'date' | 'timeSlot' | 'type' | 'status'>[],
  };
}

export async function submitBookingToSupabase(
  token: string,
  event: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt' | 'approvedBy' | 'approvedAt' | 'rejectionReason'>,
): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  const { data, error } = await supabase.rpc('submit_booking', {
    p_restaurant_token: token,
    p_date:             event.date,
    p_time_slot:        event.timeSlot,
    p_end_time:         event.endTime ?? null,
    p_type:             event.type,
    p_status:           event.status,
    p_customer_name:    event.customerName,
    p_customer_phone:   event.customerPhone,
    p_customer_email:   event.customerEmail,
    p_guest_count:      event.guestCount,
    p_package_id:       event.packageId ?? null,
    p_package_name:     event.packageName ?? null,
    p_notes:            event.notes,
  });

  if (error) return { ok: false, error: error.message };
  return data as { ok: boolean; eventId?: string; error?: string };
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
