/**
 * Loads the full workspace for a user from Supabase.
 * Called once on login and on page refresh (via AuthProvider).
 * Falls back to defaultWorkspace() if any query fails.
 */

import { fetchMenuItems, insertMenuItem } from '@/lib/supabase/queries/menu';
import { fetchTables, insertTable } from '@/lib/supabase/queries/tables';
import { fetchOrders } from '@/lib/supabase/queries/orders';
import { fetchReceipts } from '@/lib/supabase/queries/receipts';
import { fetchSettings, fetchNextOrderNumber, upsertSettings, upsertCalendarSettings, fetchCalendarSettings } from '@/lib/supabase/queries/settings';
import { fetchReservations } from '@/lib/supabase/queries/reservations';
import { fetchIngredients } from '@/lib/supabase/queries/ingredients';
import { fetchKitchenEvents } from '@/lib/supabase/queries/kitchenEvents';
import { fetchDecorations } from '@/lib/supabase/queries/decorations';
import { fetchCalendarEvents } from '@/lib/supabase/queries/calendarEvents';
import { fetchEventPackages } from '@/lib/supabase/queries/eventPackages';
import { fetchEmployees, insertEmployee } from '@/lib/supabase/queries/employees';
import { fetchShifts, insertShift } from '@/lib/supabase/queries/shifts';
import type {
  User, MenuItem, Table, Order, Receipt, BusinessSettings, StockReservation,
  Ingredient, KitchenEvent, MapDecoration, CalendarEvent, EventPackage, CalendarSettings,
  Employee, Shift,
} from '@/domain/types';
import { SEED_CATEGORIES, DEFAULT_SETTINGS } from '@/domain/initialData';

export type WorkspaceSnapshot = {
  menuItems: MenuItem[];
  categories: string[];
  tables: Table[];
  orders: Order[];
  receipts: Receipt[];
  settings: BusinessSettings;
  nextOrderNumber: number;
  reservations: StockReservation[];
  ingredients: Ingredient[];
  kitchenEvents: KitchenEvent[];
  decorations: MapDecoration[];
  calendarEvents: CalendarEvent[];
  eventPackages: EventPackage[];
  calendarSettings: CalendarSettings;
  employees: Employee[];
  shifts: Shift[];
};

export async function loadWorkspaceFromSupabase(
  userId: string,
  _user: User,
): Promise<WorkspaceSnapshot> {
  const [
    menuItems, tables, orders, receipts, settings, nextOrderNumber,
    reservations, ingredients, kitchenEvents, decorations,
    calendarEvents, eventPackages, calendarSettingsRaw, employees, shifts,
  ] = await Promise.all([
    fetchMenuItems(userId),
    fetchTables(userId),
    fetchOrders(userId),
    fetchReceipts(userId),
    fetchSettings(userId),
    fetchNextOrderNumber(userId),
    fetchReservations(userId),
    fetchIngredients(userId),
    fetchKitchenEvents(userId),
    fetchDecorations(userId),
    fetchCalendarEvents(userId),
    fetchEventPackages(userId),
    fetchCalendarSettings(userId),
    fetchEmployees(userId),
    fetchShifts(userId),
  ]);

  // If settings row is missing (signup seed failed), create it now
  let finalSettings = settings;
  if (!finalSettings || !finalSettings.restaurantToken) {
    finalSettings = {
      ...DEFAULT_SETTINGS,
      businessName: _user.businessName ?? DEFAULT_SETTINGS.businessName,
      restaurantToken: crypto.randomUUID(),
      appUrl: typeof window !== 'undefined' ? window.location.origin : DEFAULT_SETTINGS.appUrl,
    };
    await upsertSettings(finalSettings, userId, nextOrderNumber).catch(() => {/* best-effort */});
  }

  const defaultCalendarSettings: CalendarSettings = {
    maxEventsPerDay: 10,
    requireApproval: true,
    advanceBookingDays: 90,
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
    workingExceptions: [],
  };

  return {
    menuItems,
    categories: SEED_CATEGORIES,
    tables,
    orders,
    receipts,
    settings: finalSettings,
    nextOrderNumber,
    reservations: reservations.filter(r => r.expiresAt > Date.now()),
    ingredients,
    kitchenEvents,
    decorations,
    calendarEvents,
    eventPackages,
    // Treat missing OR empty-object calendarSettings as absent — use defaults
    calendarSettings: (calendarSettingsRaw && (calendarSettingsRaw as CalendarSettings).workingDays?.length)
      ? calendarSettingsRaw
      : defaultCalendarSettings,
    employees,
    shifts,
  };
}

/**
 * One-time migration: push all local store data to Supabase.
 * Called on login when Supabase returns an empty workspace (no menu items,
 * no tables) but the current local store has data — meaning the user was
 * working in local mode before connecting Supabase.
 *
 * Also called manually from Settings → "Sync to Cloud".
 */
export async function pushLocalToSupabase(
  local: {
    menuItems: MenuItem[];
    tables: Table[];
    employees: Employee[];
    shifts: Shift[];
    settings: BusinessSettings;
    calendarSettings: CalendarSettings;
    nextOrderNumber: number;
  },
  userId: string,
): Promise<void> {
  await upsertSettings(local.settings, userId, local.nextOrderNumber).catch(() => {});
  await upsertCalendarSettings(local.calendarSettings, userId).catch(() => {});
  await Promise.all(local.menuItems.map(item => insertMenuItem(item, userId).catch(() => {})));
  await Promise.all(local.tables.map(table => insertTable(table, userId).catch(() => {})));
  await Promise.all(local.employees.map(emp => insertEmployee(emp, userId).catch(() => {})));
  await Promise.all(local.shifts.map(shift => insertShift(shift, userId).catch(() => {})));
}
