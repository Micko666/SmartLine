/** Menu items, categories and stock. Stock writes are server RPCs in Supabase mode. */
import { toast } from 'sonner';
import type { MenuItem, MenuItemStatus } from '../../domain/types';
import * as workspaceService from '../../services/workspaceService';
import * as bridge from '../bridge';
import { genId, now, usesSupabasePersistence, persistLocal, errorMessage } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createMenuSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'addMenuItem' | 'updateMenuItem' | 'deleteMenuItem' | 'setMenuItemStatus' | 'addCategory' | 'deleteCategory' | 'adjustStock' | 'setStock' | 'restockItem'> => ({
  // ── Menu ────────────────────────────────────────────────────────────────────
  addMenuItem(data) {
    const { menuItems, user } = get();
    const item: MenuItem = {
      ...data,
      id:         genId(),
      sortOrder:  menuItems.length + 1,
      salesCount: 0,
      createdAt:  now(),
      updatedAt:  now(),
    };
    set(s => ({ menuItems: [...s.menuItems, item] }));
    persistLocal(get);
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewMenuItem(item, user.id).catch((err: unknown) =>
        toast.error(`Failed to save menu item: ${err instanceof Error ? err.message : String(err)}`));
    }
    return item;
  },

  updateMenuItem(id, updates) {
    const prev = get().menuItems.find(m => m.id === id);
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === id ? { ...i, ...updates, updatedAt: now() } : i),
    }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistMenuItemUpdate(id, updates).catch(() => {
        if (prev) set(s => ({ menuItems: s.menuItems.map(i => i.id === id ? prev : i) }));
        toast.error('Failed to update menu item.');
      });
    }
  },

  deleteMenuItem(id) {
    const prev = get().menuItems.find(m => m.id === id);
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === id ? { ...i, status: 'archived' as MenuItemStatus, updatedAt: now() } : i),
    }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistMenuItemUpdate(id, { status: 'archived' }).catch(() => {
        if (prev) set(s => ({ menuItems: s.menuItems.map(i => i.id === id ? prev : i) }));
        toast.error('Failed to archive menu item.');
      });
    }
  },

  setMenuItemStatus(id, status) {
    const prev = get().menuItems.find(m => m.id === id);
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === id ? { ...i, status, updatedAt: now() } : i),
    }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistMenuItemUpdate(id, { status }).catch(() => {
        if (prev) set(s => ({ menuItems: s.menuItems.map(i => i.id === id ? prev : i) }));
        toast.error('Failed to update item status.');
      });
    }
  },

  addCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    set(s => {
      if (s.categories.includes(trimmed)) return s;
      return { categories: [...s.categories, trimmed] };
    });
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      const { categories, user } = get();
      import('@/lib/supabase/queries/settings').then(({ saveCategories }) =>
        saveCategories(user!.id, categories).catch(() =>
          toast.error('Failed to save category.')));
    }
  },

  deleteCategory(name) {
    set(s => ({ categories: s.categories.filter(c => c !== name) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      const { categories, user } = get();
      import('@/lib/supabase/queries/settings').then(({ saveCategories }) =>
        saveCategories(user!.id, categories).catch(() =>
          toast.error('Failed to delete category.')));
    }
  },


  // ── Stock ────────────────────────────────────────────────────────────────────
  async adjustStock(itemId, delta) {
    if (usesSupabasePersistence() && get().user?.id) {
      try { get().applyRemoteMenuItem(await workspaceService.adjustStock(itemId, delta)); return true; }
      catch (err) { toast.error(errorMessage(err, 'Failed to adjust stock.')); return false; }
    }
    set(s => ({
      menuItems: s.menuItems.map(i => {
        if (i.id !== itemId || i.stock === null) return i;
        return { ...i, stock: Math.max(0, i.stock + delta), updatedAt: now() };
      }),
    }));
    persistLocal(get);
    return true;
  },

  async setStock(itemId, stock) {
    const item = get().menuItems.find(m => m.id === itemId);
    if (!item) return false;
    const value = Math.max(0, Math.floor(stock));
    if (usesSupabasePersistence() && get().user?.id) {
      try { get().applyRemoteMenuItem(await workspaceService.setStock(item, value)); return true; }
      catch (err) { toast.error(errorMessage(err, 'Failed to set stock.')); return false; }
    }
    set(s => ({ menuItems: s.menuItems.map(i => i.id === itemId ? { ...i, stock: value, updatedAt: now() } : i) }));
    persistLocal(get);
    return true;
  },

  async restockItem(itemId) {
    const item = get().menuItems.find(m => m.id === itemId);
    if (!item || item.maxStock === null) return false;
    return get().setStock(itemId, item.maxStock);
  },
});
