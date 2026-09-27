/** Business settings (field-level patch) and station profiles (server-hashed PINs). */
import { toast } from 'sonner';
import type { Station } from '../../domain/types';
import * as workspaceService from '../../services/workspaceService';
import { normalizeStation } from '../../domain/stations';
import { usesSupabasePersistence, persistLocal, errorMessage } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createSettingsSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'updateSettings' | 'addStation' | 'updateStation' | 'deleteStation'> => ({
  async updateSettings(input) {
    const prev = get().settings;
    // Forms pass the whole settings object; keep only what actually changed.
    const updates = Object.fromEntries(Object.entries(input).filter(([key, value]) =>
      key !== 'stations' && JSON.stringify(value) !== JSON.stringify(prev[key as keyof typeof prev]))) as typeof input;
    if (Object.keys(updates).length === 0) return true;
    set(s => ({ settings: { ...s.settings, ...updates, stations: s.stations } }));
    persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        // Patch only the changed fields: a stale full-row upsert could overwrite
        // concurrent edits from another device.
        const saved = await workspaceService.patchSettings(updates);
        set(s => ({ settings: { ...saved, stations: s.stations } }));
      } catch (err) {
        set(s => ({ settings: { ...prev, stations: s.stations } }));
        toast.error(errorMessage(err, 'Failed to save settings.'));
        return false;
      }
    }
    return true;
  },


  // ── Stations ─────────────────────────────────────────────────────────────────
  async addStation(station) {
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        const saved = await workspaceService.saveStation(stationPayload(station, station.pin ? station.pin : undefined));
        set(st => withStations(st, [...st.stations, saved]));
        return true;
      } catch (err) { toast.error(errorMessage(err, 'Failed to save station.')); return false; }
    }
    const normalized = normalizeStation({ ...station, hasPin: !!station.pin });
    set(st => withStations(st, [...st.stations, normalized]));
    persistLocal(get);
    return true;
  },

  async updateStation(id, updates) {
    const current = get().stations.find(st => st.id === id);
    if (!current) return false;
    const { removePin, pin, ...rest } = updates;
    const nextPin = removePin ? '' : (pin ? pin : undefined);
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        const saved = await workspaceService.saveStation(stationPayload({ ...current, ...rest }, nextPin));
        set(st => withStations(st, st.stations.map(x => x.id === id ? saved : x)));
        return true;
      } catch (err) { toast.error(errorMessage(err, 'Failed to update station.')); return false; }
    }
    const localPin = nextPin === undefined ? current.pin : nextPin;
    const updated = normalizeStation({ ...current, ...rest, pin: localPin, hasPin: !!localPin });
    set(st => withStations(st, st.stations.map(x => x.id === id ? updated : x)));
    persistLocal(get);
    return true;
  },

  async deleteStation(id) {
    if (usesSupabasePersistence() && get().user?.id) {
      try { await workspaceService.deleteStation(id); }
      catch (err) { toast.error(errorMessage(err, 'Failed to delete station.')); return false; }
    }
    set(st => withStations(st, st.stations.filter(x => x.id !== id)));
    persistLocal(get);
    return true;
  },
});
/** Keeps the two station views (top-level slice + settings mirror) identical. */
function withStations(state: AppState, stations: Station[]): Partial<AppState> {
  return { stations, settings: { ...state.settings, stations } };
}

/** Server payload for upsert_station; `pin` present only when it should change. */
function stationPayload(station: Station, pin: string | undefined): Station & { pin?: string } {
  const { hasPin: _hasPin, pin: _pin, ...rest } = station;
  return (pin === undefined ? rest : { ...rest, pin }) as Station & { pin?: string };
}

