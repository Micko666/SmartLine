/**
 * Write-through bridge — fires Supabase writes in the background after
 * Zustand has already applied the optimistic update.
 *
 * Each function returns a Promise<void>. On failure the caller is responsible
 * for rolling back the Zustand state and showing a toast.
 *
 * Import pattern in the store:
 *   if (isSupabaseEnabled() && userId) {
 *     bridge.persistMenuItem(item, userId).catch(() => { rollback(); toast.error(...) });
 *   }
 */

import { updateMenuItemRow, insertMenuItem, bulkUpdateSortOrder } from '@/lib/supabase/queries/menu';
import { insertTable, updateTableRow, deleteTableRow } from '@/lib/supabase/queries/tables';
import { updateOrderRow } from '@/lib/supabase/queries/orders';
import { upsertSettings, upsertCalendarSettings } from '@/lib/supabase/queries/settings';
import { insertReservation, deleteReservationBySession } from '@/lib/supabase/queries/reservations';
import { insertIngredient, updateIngredientRow, deleteIngredientRow } from '@/lib/supabase/queries/ingredients';
import { insertKitchenEvent } from '@/lib/supabase/queries/kitchenEvents';
import { insertDecoration, updateDecorationRow, deleteDecorationRow } from '@/lib/supabase/queries/decorations';
import { insertCalendarEvent, updateCalendarEventRow, deleteCalendarEventRow } from '@/lib/supabase/queries/calendarEvents';
import { insertEventPackage, updateEventPackageRow, deleteEventPackageRow } from '@/lib/supabase/queries/eventPackages';
import { insertEmployee, updateEmployeeRow, deleteEmployeeRow } from '@/lib/supabase/queries/employees';
import { insertShift, updateShiftRow, deleteShiftRow } from '@/lib/supabase/queries/shifts';
import type {
  MenuItem, Table, Order, BusinessSettings, StockReservation, Ingredient, KitchenEvent, MapDecoration,
  CalendarEvent, EventPackage, Employee, Shift, CalendarSettings,
} from '@/domain/types';

// ─── Menu ─────────────────────────────────────────────────────────────────────

export async function persistNewMenuItem(item: MenuItem, userId: string): Promise<void> {
  await insertMenuItem(item, userId);
}

export async function persistMenuItemUpdate(
  id: string,
  updates: Partial<MenuItem>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name          !== undefined) dbUpdates.name          = updates.name;
  if (updates.description   !== undefined) dbUpdates.description   = updates.description;
  if (updates.category      !== undefined) dbUpdates.category      = updates.category;
  if (updates.price         !== undefined) dbUpdates.price         = updates.price;
  if (updates.prepTime      !== undefined) dbUpdates.prep_time     = updates.prepTime;
  if (updates.stock         !== undefined) dbUpdates.stock         = updates.stock;
  if (updates.maxStock      !== undefined) dbUpdates.max_stock     = updates.maxStock;
  if (updates.status        !== undefined) dbUpdates.status        = updates.status;
  if (updates.icon          !== undefined) dbUpdates.icon          = updates.icon;
  if (updates.imageUrl      !== undefined) dbUpdates.image_url     = updates.imageUrl;
  if (updates.thumbnailUrl  !== undefined) dbUpdates.thumbnail_url = updates.thumbnailUrl;
  if (updates.tags          !== undefined) dbUpdates.tags          = updates.tags;
  if (updates.modifiers     !== undefined) dbUpdates.modifiers     = updates.modifiers;
  if (updates.sortOrder     !== undefined) dbUpdates.sort_order      = updates.sortOrder;
  if (updates.salesCount    !== undefined) dbUpdates.sales_count     = updates.salesCount;
  if ('allergens'      in updates) dbUpdates.allergens       = updates.allergens      ?? null;
  if ('dietaryTags'    in updates) dbUpdates.dietary_tags    = updates.dietaryTags    ?? null;
  if ('calories'       in updates) dbUpdates.calories        = updates.calories       ?? null;
  if ('costPerServing' in updates) dbUpdates.cost_per_serving = updates.costPerServing ?? null;
  if ('recipe'         in updates) dbUpdates.recipe          = updates.recipe         ?? null;
  await updateMenuItemRow(id, dbUpdates);
}

export async function persistMenuItemReorder(
  items: { id: string; sortOrder: number }[],
): Promise<void> {
  await bulkUpdateSortOrder(items);
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export async function persistNewTable(table: Table, userId: string): Promise<void> {
  await insertTable(table, userId);
}

export async function persistTableUpdate(
  id: string,
  updates: Partial<Table>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name     !== undefined) dbUpdates.name     = updates.name;
  if (updates.number   !== undefined) dbUpdates.number   = updates.number;
  if (updates.capacity !== undefined) dbUpdates.capacity = updates.capacity;
  if (updates.status   !== undefined) dbUpdates.status   = updates.status;
  if (updates.shape    !== undefined) dbUpdates.shape    = updates.shape;
  if ('zone'  in updates)             dbUpdates.zone     = updates.zone  ?? null;
  if ('floor'     in updates)          dbUpdates.floor      = updates.floor     ?? null;
  if ('rotation'  in updates)          dbUpdates.rotation   = updates.rotation  ?? 0;
  if ('sizeScale' in updates)          dbUpdates.size_scale = updates.sizeScale ?? 1;
  if ('x'         in updates)          dbUpdates.x          = updates.x         ?? null;
  if ('y'         in updates)          dbUpdates.y          = updates.y         ?? null;
  await updateTableRow(id, dbUpdates);
}

export async function persistDeleteTable(id: string): Promise<void> {
  await deleteTableRow(id);
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function persistOrderUpdate(
  id: string,
  updates: Partial<Order>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status              !== undefined) dbUpdates.status               = updates.status;
  if (updates.prepTimeAdjustment  !== undefined) dbUpdates.prep_time_adjustment = updates.prepTimeAdjustment;
  await updateOrderRow(id, dbUpdates);
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function persistSettings(
  settings: BusinessSettings,
  userId: string,
): Promise<void> {
  await upsertSettings(settings, userId);
}

// ─── Ingredients ─────────────────────────────────────────────────────────────

export async function persistNewIngredient(ing: Ingredient, userId: string): Promise<void> {
  await insertIngredient(ing, userId);
}

export async function persistIngredientUpdate(
  id: string,
  updates: Partial<Ingredient>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name         !== undefined) dbUpdates.name          = updates.name;
  if (updates.unit         !== undefined) dbUpdates.unit          = updates.unit;
  if (updates.costPerUnit  !== undefined) dbUpdates.cost_per_unit = updates.costPerUnit;
  if ('stock' in updates)                 dbUpdates.stock         = updates.stock ?? null;
  await updateIngredientRow(id, dbUpdates);
}

export async function persistDeleteIngredient(id: string): Promise<void> {
  await deleteIngredientRow(id);
}

// ─── Kitchen Events ───────────────────────────────────────────────────────────

export async function persistKitchenEvent(event: KitchenEvent, userId: string): Promise<void> {
  await insertKitchenEvent(event, userId);
}

// ─── Reservations ─────────────────────────────────────────────────────────────

export async function persistNewReservation(
  reservation: StockReservation,
  userId: string,
): Promise<void> {
  await insertReservation(reservation, userId);
}

export async function persistReleaseReservation(
  sessionId: string,
  userId: string,
): Promise<void> {
  await deleteReservationBySession(sessionId, userId);
}

// ─── Map Decorations ──────────────────────────────────────────────────────────

export async function persistNewDecoration(dec: MapDecoration, userId: string): Promise<void> {
  await insertDecoration(dec, userId);
}

export async function persistDecorationUpdate(
  id: string,
  updates: Partial<MapDecoration>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.x        !== undefined) dbUpdates.x        = updates.x;
  if (updates.y        !== undefined) dbUpdates.y        = updates.y;
  if (updates.w        !== undefined) dbUpdates.w        = updates.w;
  if (updates.h        !== undefined) dbUpdates.h        = updates.h;
  if (updates.rotation !== undefined) dbUpdates.rotation = updates.rotation;
  if ('floor' in updates)             dbUpdates.floor    = updates.floor ?? null;
  await updateDecorationRow(id, dbUpdates);
}

export async function persistDeleteDecoration(id: string): Promise<void> {
  await deleteDecorationRow(id);
}

// ─── Calendar Events ──────────────────────────────────────────────────────────

export async function persistNewCalendarEvent(event: CalendarEvent, userId: string): Promise<void> {
  await insertCalendarEvent(event, userId);
}

export async function persistCalendarEventUpdate(
  id: string,
  updates: Partial<CalendarEvent>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.status          !== undefined) dbUpdates.status           = updates.status;
  if (updates.date            !== undefined) dbUpdates.date             = updates.date;
  if (updates.timeSlot        !== undefined) dbUpdates.time_slot        = updates.timeSlot;
  if ('endTime'          in updates) dbUpdates.end_time         = updates.endTime          ?? null;
  if ('approvedBy'       in updates) dbUpdates.approved_by      = updates.approvedBy       ?? null;
  if ('approvedAt'       in updates) dbUpdates.approved_at      = updates.approvedAt       ?? null;
  if ('rejectionReason'  in updates) dbUpdates.rejection_reason = updates.rejectionReason  ?? null;
  if ('guestCount'       in updates) dbUpdates.guest_count      = updates.guestCount;
  if ('notes'            in updates) dbUpdates.notes            = updates.notes            ?? '';
  await updateCalendarEventRow(id, dbUpdates);
}

export async function persistDeleteCalendarEvent(id: string): Promise<void> {
  await deleteCalendarEventRow(id);
}

// ─── Event Packages ───────────────────────────────────────────────────────────

export async function persistNewEventPackage(pkg: EventPackage, userId: string): Promise<void> {
  await insertEventPackage(pkg, userId);
}

export async function persistEventPackageUpdate(
  id: string,
  updates: Partial<EventPackage>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name            !== undefined) dbUpdates.name             = updates.name;
  if (updates.emoji           !== undefined) dbUpdates.emoji            = updates.emoji;
  if (updates.description     !== undefined) dbUpdates.description      = updates.description;
  if (updates.minGuests       !== undefined) dbUpdates.min_guests       = updates.minGuests;
  if (updates.maxGuests       !== undefined) dbUpdates.max_guests       = updates.maxGuests;
  if ('fixedPrice'      in updates) dbUpdates.fixed_price      = updates.fixedPrice     ?? null;
  if ('pricePerPerson'  in updates) dbUpdates.price_per_person = updates.pricePerPerson ?? null;
  if (updates.duration        !== undefined) dbUpdates.duration         = updates.duration;
  if (updates.details         !== undefined) dbUpdates.details          = updates.details;
  if (updates.active          !== undefined) dbUpdates.active           = updates.active;
  await updateEventPackageRow(id, dbUpdates);
}

export async function persistDeleteEventPackage(id: string): Promise<void> {
  await deleteEventPackageRow(id);
}

// ─── Calendar Settings ────────────────────────────────────────────────────────

export async function persistCalendarSettings(
  settings: CalendarSettings,
  userId: string,
): Promise<void> {
  await upsertCalendarSettings(settings, userId);
}

// ─── Employees ────────────────────────────────────────────────────────────────

export async function persistNewEmployee(emp: Employee, userId: string): Promise<void> {
  await insertEmployee(emp, userId);
}

export async function persistEmployeeUpdate(
  id: string,
  updates: Partial<Employee>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.name   !== undefined) dbUpdates.name   = updates.name;
  if (updates.role   !== undefined) dbUpdates.role   = updates.role;
  if (updates.color  !== undefined) dbUpdates.color  = updates.color;
  if (updates.active !== undefined) dbUpdates.active = updates.active;
  if ('phone' in updates) dbUpdates.phone = updates.phone ?? null;
  if ('email' in updates) dbUpdates.email = updates.email ?? null;
  await updateEmployeeRow(id, dbUpdates);
}

export async function persistDeleteEmployee(id: string): Promise<void> {
  await deleteEmployeeRow(id);
}

// ─── Shifts ───────────────────────────────────────────────────────────────────

export async function persistNewShift(shift: Shift, userId: string): Promise<void> {
  await insertShift(shift, userId);
}

export async function persistShiftUpdate(
  id: string,
  updates: Partial<Shift>,
): Promise<void> {
  const dbUpdates: Record<string, unknown> = {};
  if (updates.date        !== undefined) dbUpdates.date         = updates.date;
  if (updates.name        !== undefined) { dbUpdates.name = updates.name; dbUpdates.role = updates.name; }
  if (updates.startTime   !== undefined) dbUpdates.start_time   = updates.startTime;
  if (updates.endTime     !== undefined) dbUpdates.end_time     = updates.endTime;
  if (updates.color       !== undefined) dbUpdates.color        = updates.color;
  if ('stationId' in updates)            dbUpdates.station_id   = updates.stationId ?? null;
  if (updates.assignments !== undefined) {
    dbUpdates.assignments  = updates.assignments;
    dbUpdates.employee_ids = updates.assignments.map(a => a.employeeId);
  }
  if (updates.minStaff    !== undefined) dbUpdates.min_staff    = updates.minStaff;
  if ('notes' in updates) dbUpdates.notes = updates.notes ?? '';
  await updateShiftRow(id, dbUpdates);
}

export async function persistDeleteShift(id: string): Promise<void> {
  await deleteShiftRow(id);
}
