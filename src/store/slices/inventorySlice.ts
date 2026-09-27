/** Ingredients and kitchen events. */
import { toast } from 'sonner';
import type { Ingredient, KitchenEvent } from '../../domain/types';
import * as bridge from '../bridge';
import { genId, now, usesSupabasePersistence, persistLocal } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createInventorySlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'addIngredient' | 'updateIngredient' | 'deleteIngredient' | 'logKitchenEvent'> => ({
  // ── Settings ─────────────────────────────────────────────────────────────────
  // ── Ingredients ─────────────────────────────────────────────────────────────
  addIngredient(data) {
    const ingredient: Ingredient = { ...data, id: genId(), createdAt: now(), updatedAt: now() };
    set(s => ({ ingredients: [...s.ingredients, ingredient] }));
    persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewIngredient(ingredient, user.id).catch(() =>
        toast.error('Failed to save ingredient.'));
    }
    return ingredient;
  },

  updateIngredient(id, updates) {
    set(s => ({
      ingredients: s.ingredients.map(i =>
        i.id === id ? { ...i, ...updates, updatedAt: now() } : i),
    }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistIngredientUpdate(id, updates).catch(() =>
        toast.error('Failed to update ingredient.'));
    }
  },

  deleteIngredient(id) {
    set(s => ({ ingredients: s.ingredients.filter(i => i.id !== id) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistDeleteIngredient(id).catch(() =>
        toast.error('Failed to delete ingredient.'));
    }
  },


  // ── Kitchen Events ───────────────────────────────────────────────────────────
  logKitchenEvent(data) {
    const event: KitchenEvent = { ...data, id: genId(), createdAt: now() };
    set(s => ({ kitchenEvents: [event, ...s.kitchenEvents].slice(0, 500) }));
    persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistKitchenEvent(event, user.id).catch(() => {/* best-effort, non-critical */});
    }
  },
});
