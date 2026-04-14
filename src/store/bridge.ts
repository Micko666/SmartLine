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
import { upsertSettings } from '@/lib/supabase/queries/settings';
import { insertReservation, deleteReservationBySession } from '@/lib/supabase/queries/reservations';
import { insertIngredient, updateIngredientRow, deleteIngredientRow } from '@/lib/supabase/queries/ingredients';
import { insertKitchenEvent } from '@/lib/supabase/queries/kitchenEvents';
import { insertDecoration, updateDecorationRow, deleteDecorationRow } from '@/lib/supabase/queries/decorations';
import type { MenuItem, Table, Order, BusinessSettings, StockReservation, Ingredient, KitchenEvent, MapDecoration } from '@/domain/types';

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
