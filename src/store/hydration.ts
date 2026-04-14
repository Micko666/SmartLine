/**
 * Loads the full workspace for a user from Supabase.
 * Called once on login and on page refresh (via AuthProvider).
 * Falls back to defaultWorkspace() if any query fails.
 */

import { fetchMenuItems } from '@/lib/supabase/queries/menu';
import { fetchTables } from '@/lib/supabase/queries/tables';
import { fetchOrders } from '@/lib/supabase/queries/orders';
import { fetchReceipts } from '@/lib/supabase/queries/receipts';
import { fetchSettings, fetchNextOrderNumber, upsertSettings } from '@/lib/supabase/queries/settings';
import { fetchReservations } from '@/lib/supabase/queries/reservations';
import { fetchIngredients } from '@/lib/supabase/queries/ingredients';
import { fetchKitchenEvents } from '@/lib/supabase/queries/kitchenEvents';
import { fetchDecorations } from '@/lib/supabase/queries/decorations';
import type { User, MenuItem, Table, Order, Receipt, BusinessSettings, StockReservation, Ingredient, KitchenEvent, MapDecoration } from '@/domain/types';
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
};

export async function loadWorkspaceFromSupabase(
  userId: string,
  _user: User,
): Promise<WorkspaceSnapshot> {
  const [menuItems, tables, orders, receipts, settings, nextOrderNumber, reservations, ingredients, kitchenEvents, decorations] =
    await Promise.all([
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
  };
}
