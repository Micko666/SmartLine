/** Shared constants/helpers extracted from MenuManager.tsx (behavior-preserving split). */
import type { MenuItem, MenuItemStatus } from '@/domain/types';
import { SEED_CATEGORIES } from '@/domain/initialData';


export const SEED_CAT_SET = new Set(SEED_CATEGORIES);

// ─── Constants ────────────────────────────────────────────────────────────────

export const ALLERGEN_LIST = [
  { id: 'gluten',    label: 'Gluten',    emoji: '🌾' },
  { id: 'dairy',     label: 'Dairy',     emoji: '🥛' },
  { id: 'eggs',      label: 'Eggs',      emoji: '🥚' },
  { id: 'nuts',      label: 'Tree Nuts', emoji: '🌰' },
  { id: 'peanuts',   label: 'Peanuts',   emoji: '🥜' },
  { id: 'soy',       label: 'Soy',       emoji: '🫘' },
  { id: 'shellfish', label: 'Shellfish', emoji: '🦞' },
  { id: 'fish',      label: 'Fish',      emoji: '🐟' },
  { id: 'sesame',    label: 'Sesame',    emoji: '🫙' },
];

export const DIETARY_LIST = [
  { id: 'vegetarian', label: 'Vegetarian', color: 'bg-green-500/10 text-green-700 border-green-200' },
  { id: 'vegan',      label: 'Vegan',      color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200' },
  { id: 'gluten-free',label: 'Gluten-Free',color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  { id: 'dairy-free', label: 'Dairy-Free', color: 'bg-blue-500/10 text-blue-700 border-blue-200' },
  { id: 'halal',      label: 'Halal',      color: 'bg-teal-500/10 text-teal-700 border-teal-200' },
  { id: 'kosher',     label: 'Kosher',     color: 'bg-purple-500/10 text-purple-700 border-purple-200' },
  { id: 'spicy',      label: 'Spicy 🌶',   color: 'bg-red-500/10 text-red-700 border-red-200' },
];

export const ITEM_STATUS_CONFIG: Record<MenuItemStatus, { label: string; badgeClass: string }> = {
  active:   { label: 'Active',   badgeClass: 'bg-success/10 text-success' },
  disabled: { label: 'Disabled', badgeClass: 'bg-warning/10 text-warning' },
  archived: { label: 'Archived', badgeClass: 'bg-muted text-muted-foreground' },
};

export type ViewFilter = 'active' | 'disabled' | 'archived' | 'all';

// ─── Kitchen unit helpers ─────────────────────────────────────────────────────

/** For a given purchase/storage unit, return the kitchen-friendly unit options with conversion factors. */
export function kitchenUnitsFor(purchaseUnit: string): Array<{ label: string; toPurchase: number }> {
  if (purchaseUnit === 'kg') return [{ label: 'g', toPurchase: 0.001 }, { label: 'kg', toPurchase: 1 }];
  if (purchaseUnit === 'l')  return [{ label: 'ml', toPurchase: 0.001 }, { label: 'l', toPurchase: 1 }];
  return [{ label: purchaseUnit, toPurchase: 1 }];
}

/** Default kitchen quantity and unit when adding an ingredient to a recipe. */
export function defaultKitchenEntry(purchaseUnit: string): { unit: string; qty: number } {
  if (purchaseUnit === 'kg') return { unit: 'g', qty: 100 };
  if (purchaseUnit === 'l')  return { unit: 'ml', qty: 100 };
  return { unit: purchaseUnit, qty: 1 };
}

/** Convert a stored quantity (in purchase unit) to a kitchen-friendly display value. */
export function toDisplayQty(storedQty: number, purchaseUnit: string): { qty: number; unit: string } {
  if (purchaseUnit === 'kg' && storedQty < 1) return { qty: Math.round(storedQty * 1000), unit: 'g' };
  if (purchaseUnit === 'l'  && storedQty < 1) return { qty: Math.round(storedQty * 1000), unit: 'ml' };
  const val = storedQty < 10
    ? parseFloat(storedQty.toFixed(3))
    : parseFloat(storedQty.toFixed(1));
  return { qty: val, unit: purchaseUnit };
}

// ─── Menu Item Form ───────────────────────────────────────────────────────────

export type FormData = Omit<MenuItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'salesCount'>;
