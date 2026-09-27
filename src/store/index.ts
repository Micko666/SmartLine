/**
 * Single Zustand store. State contract: ./types.ts; actions: ./slices/*.
 * Business rules live in src/domain, persistence in src/services + ./bridge;
 * slices orchestrate them for local (localStorage) and Supabase modes.
 */
import { create } from 'zustand';
import type { BusinessSettings } from '../domain/types';
import { DEFAULT_SETTINGS } from '../domain/initialData';
import { WORKSPACE_KEY, emptyWorkspace, loadWorkspaceStateLocal } from './workspace';
import { activeUserId, setActiveUserId, usesSupabasePersistence } from './runtime';
import type { AppState } from './types';
import { createSessionSlice } from './slices/sessionSlice';
import { createRemoteSlice } from './slices/remoteSlice';
import { createMenuSlice } from './slices/menuSlice';
import { createFloorSlice } from './slices/floorSlice';
import { createOrderSlice } from './slices/orderSlice';
import { createSettingsSlice } from './slices/settingsSlice';
import { createInventorySlice } from './slices/inventorySlice';
import { createCalendarSlice } from './slices/calendarSlice';
import { createStaffSlice } from './slices/staffSlice';

export type { AppState } from './types';

export const useStore = create<AppState>()((set, get) => ({
  _hasHydrated:    false,
  user:            null,
  isAuthenticated: false,
  ...emptyWorkspace(),

  ...emptyWorkspace(),

  ...createSessionSlice(set, get),
  ...createRemoteSlice(set, get),
  ...createMenuSlice(set, get),
  ...createFloorSlice(set, get),
  ...createOrderSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createInventorySlice(set, get),
  ...createCalendarSlice(set, get),
  ...createStaffSlice(set, get),
}));

// ─── Cross-tab sync (local mode only) ────────────────────────────────────────
// The storage event fires in every tab EXCEPT the one that wrote the value.
// This keeps the admin tab live when a customer tab calls checkout() or submits
// a booking — no page refresh needed.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    const userId = activeUserId();
    if (usesSupabasePersistence() || !userId) return;
    if (e.key !== WORKSPACE_KEY(userId) || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (!parsed?.state) return;
      const { user, _hasHydrated } = useStore.getState();
      if (!_hasHydrated) {
        // Public pages (booking, station, etc.) — store not hydrated.
        // Only patch in the fields that public pages need so they stay live
        // without clobbering or restoring anything else.
        const { calendarEvents, orders } = parsed.state;
        const patch: Partial<AppState> = {};
        if (calendarEvents) patch.calendarEvents = calendarEvents;
        if (orders)         patch.orders         = orders;
        if (Object.keys(patch).length) useStore.setState(patch);
        return;
      }
      if (!user) return;
      const fresh = loadWorkspaceStateLocal(userId, user);
      useStore.getState().hydrateWorkspace(user, fresh, 'local');
    } catch { /* ignore */ }
  });
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Read settings directly from localStorage (bypasses the in-memory store).
 * Use in public pages whose Zustand store is unhydrated — e.g. OrderPortal,
 * BookingPage — so they always see the latest admin-saved values.
 */
export function getPersistedSettings(): BusinessSettings | null {
  const userId = activeUserId();
  if (usesSupabasePersistence() || !userId) return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.settings) return { ...DEFAULT_SETTINGS, ...parsed.state.settings };
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Test utility ─────────────────────────────────────────────────────────────

export function _resetStoreForTesting() {
  setActiveUserId(null);
  if (typeof localStorage !== 'undefined') localStorage.clear();
}
