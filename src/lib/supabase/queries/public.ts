/**
 * Public (unauthenticated) queries for the customer-facing menu.
 * Uses a single RPC (get_customer_menu) to fetch everything in one round trip.
 */

import { supabase } from '../client';
import { mapMenuItemRow, mapSettingsRow, mapTableRow } from '../mappers';
import type { MenuItem, BusinessSettings, Table } from '@/domain/types';

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
