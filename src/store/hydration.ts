/**
 * Loads the full workspace for a user from Supabase.
 * Called once on login and on page refresh (via AuthProvider).
 * Falls back to defaultWorkspace() if any query fails.
 */

import { fetchMenuItems, insertMenuItem } from '@/lib/supabase/queries/menu';
import { fetchTables, insertTable } from '@/lib/supabase/queries/tables';
import { fetchOrders } from '@/lib/supabase/queries/orders';
import { listStations } from '@/services/workspaceService';
import { fetchSettings, fetchNextOrderNumber, upsertSettings, upsertCalendarSettings, fetchCalendarSettings, fetchCategories } from '@/lib/supabase/queries/settings';
import { fetchReservations } from '@/lib/supabase/queries/reservations';
import { fetchIngredients } from '@/lib/supabase/queries/ingredients';
import { fetchKitchenEvents } from '@/lib/supabase/queries/kitchenEvents';
import { fetchDecorations } from '@/lib/supabase/queries/decorations';
import { fetchCalendarEvents } from '@/lib/supabase/queries/calendarEvents';
import { fetchEventPackages } from '@/lib/supabase/queries/eventPackages';
import { fetchEmployees, insertEmployee } from '@/lib/supabase/queries/employees';
import { fetchShifts, insertShift } from '@/lib/supabase/queries/shifts';
import type {
  Station,
  User, MenuItem, Table, Order, Receipt, BusinessSettings, StockReservation,
  Ingredient, KitchenEvent, MapDecoration, CalendarEvent, EventPackage, CalendarSettings,
  Employee, Shift,
} from '@/domain/types';
import { SEED_CATEGORIES, DEFAULT_SETTINGS } from '@/domain/initialData';

import { DEFAULT_CALENDAR_SETTINGS, normalizeWorkspace, type WorkspaceSnapshot } from './workspace';
export type { WorkspaceSnapshot } from './workspace';

export async function loadWorkspaceFromSupabase(
  userId: string,
  _user: User,
): Promise<WorkspaceSnapshot> {
  const [
    menuItems, tables, orders, stations, settings, nextOrderNumber,
    reservations, ingredients, kitchenEvents, decorations,
    calendarEvents, eventPackages, calendarSettingsRaw, employees, shifts,
    storedCategories,
  ] = await Promise.all([
    fetchMenuItems(userId),
    fetchTables(userId),
    fetchOrders(userId),
    // Stations live in their own table (migration 018); PINs are never returned.
    listStations().catch(() => [] as Station[]),
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
    fetchCategories(userId),
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

  // Merge stored categories (user-created) with any categories already in use
  // by menu items, then fall back to seed defaults so the list is never empty.
  // Stored categories come from the `categories` JSONB column (migration 010).
  const itemCategories = menuItems.map(m => m.category).filter(Boolean);
  const mergedCategories = [
    ...new Set([...storedCategories, ...itemCategories, ...SEED_CATEGORIES]),
  ];

  return normalizeWorkspace({
    menuItems,
    categories: mergedCategories,
    tables,
    orders,
    // Receipts are only needed on the customer receipt page (fetched by id there).
    receipts: [],
    settings: { ...finalSettings, stations },
    stations,
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
      : DEFAULT_CALENDAR_SETTINGS,
    employees,
    shifts,
  });
}

/**
 * One-time migration: push all local store data to Supabase.
 * Called on login when Supabase returns an empty workspace (no menu items,
 * no tables) but the current local store has data — meaning the user was
 * working in local mode before connecting Supabase.
 *
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
