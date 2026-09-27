/** Tables, floor-map decorations and table status. */
import { toast } from 'sonner';
import type { Table, MapDecoration } from '../../domain/types';
import * as bridge from '../bridge';
import { genId, now, usesSupabasePersistence, persistLocal } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createFloorSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'addTable' | 'updateTable' | 'deleteTable' | 'addDecoration' | 'updateDecoration' | 'deleteDecoration' | 'setTableStatus'> => ({
  // ── Tables ──────────────────────────────────────────────────────────────────
  addTable(data) {
    const table: Table = {
      id: genId(), number: data.number, name: data.name,
      capacity: data.capacity, status: 'available',
      shape:     data.shape ?? 'square',
      zone:      data.zone,
      floor:     data.floor,
      rotation:  data.rotation  ?? 0,
      sizeScale: data.sizeScale ?? 1,
      x: data.x ?? null,
      y: data.y ?? null,
      createdAt: now(),
    };
    set(s => ({ tables: [...s.tables, table] }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistNewTable(table, get().user!.id).catch((err: unknown) =>
        toast.error(`Failed to save table: ${err instanceof Error ? err.message : String(err)}`));
    }
    return table;
  },

  updateTable(id, updates) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.map(t => t.id === id ? { ...t, ...updates } : t) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistTableUpdate(id, updates).catch(() => {
        if (prev) set(s => ({ tables: s.tables.map(t => t.id === id ? prev : t) }));
        toast.error('Failed to update table.');
      });
    }
  },

  deleteTable(id) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.filter(t => t.id !== id) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistDeleteTable(id).catch(() => {
        if (prev) set(s => ({ tables: [...s.tables, prev] }));
        toast.error('Failed to delete table.');
      });
    }
  },

  addDecoration(data) {
    const dec: MapDecoration = {
      id: genId(), type: data.type,
      x: data.x, y: data.y, w: data.w, h: data.h,
      floor: data.floor, rotation: data.rotation ?? 0,
    };
    set(s => ({ decorations: [...s.decorations, dec] }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistNewDecoration(dec, get().user!.id).catch((err: unknown) =>
        toast.error(`Failed to save decoration: ${err instanceof Error ? err.message : String(err)}`));
    }
    return dec;
  },

  updateDecoration(id, updates) {
    set(s => ({ decorations: s.decorations.map(d => d.id === id ? { ...d, ...updates } : d) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistDecorationUpdate(id, updates).catch(() =>
        toast.error('Failed to update decoration.'));
    }
  },

  deleteDecoration(id) {
    const prev = get().decorations.find(d => d.id === id);
    set(s => ({ decorations: s.decorations.filter(d => d.id !== id) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistDeleteDecoration(id).catch(() => {
        if (prev) set(s => ({ decorations: [...s.decorations, prev] }));
        toast.error('Failed to delete decoration.');
      });
    }
  },

  setTableStatus(id, status) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.map(t => t.id === id ? { ...t, status } : t) }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistTableUpdate(id, { status }).catch(() => {
        if (prev) set(s => ({ tables: s.tables.map(t => t.id === id ? prev : t) }));
        toast.error('Failed to update table status.');
      });
    }
  },
});
