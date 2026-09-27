/** Auth + workspace lifecycle: login/signup/logout, canonical hydration and resets. */
import type { User } from '../../domain/types';
import { DEMO_USER } from '../../domain/initialData';
import { AUTH_KEY, defaultWorkspace, emptyWorkspace, normalizeWorkspace, loadWorkspaceStateLocal } from '../workspace';
import { isSupabaseEnabled } from '../flags';
import { genId, now, setActiveUserId } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createSessionSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'hydrateWorkspace' | 'restoreLocalSession' | 'resetWorkspace' | 'hydrateCustomerContext' | 'hydrateStationContext' | 'login' | 'logout' | 'signup'> => ({
  hydrateWorkspace(user, workspace, source = 'supabase') {
    setActiveUserId(source === 'local' ? user.id : null);
    set({ ...normalizeWorkspace(workspace), user, isAuthenticated: true, _hasHydrated: true });
  },

  restoreLocalSession() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      const auth = raw ? JSON.parse(raw) : null;
      if (auth?.user?.id && auth.isAuthenticated) {
        get().hydrateWorkspace(auth.user, loadWorkspaceStateLocal(auth.user.id, auth.user), 'local');
        return true;
      }
    } catch { /* Invalid authentication data must not expose a prior workspace. */ }
    get().resetWorkspace();
    return false;
  },

  resetWorkspace() {
    setActiveUserId(null);
    set({ ...emptyWorkspace(), user: null, isAuthenticated: false, _hasHydrated: true });
  },

  hydrateCustomerContext({ settings, menuItems, tables }) {
    // Public context never carries station credentials or owner-only fields.
    set({ settings: { ...settings, stations: [] }, menuItems, tables, stations: [] });
  },

  hydrateStationContext({ restaurantName, menuItems, tables, decorations }) {
    set(s => ({ menuItems, tables, decorations, settings: { ...s.settings, businessName: restaurantName, stations: [] }, stations: [] }));
  },

  // ── Auth ────────────────────────────────────────────────────────────────────
  async login(email, password) {
    // Demo account always uses local path regardless of Supabase
    if (email === 'demo@smartline.io' && password === 'demo1234') {
      setActiveUserId(DEMO_USER.id);
      localStorage.setItem(AUTH_KEY, JSON.stringify({ user: DEMO_USER, isAuthenticated: true }));
      const workspace = loadWorkspaceStateLocal(DEMO_USER.id, DEMO_USER);
      get().hydrateWorkspace(DEMO_USER, workspace, 'local');
      return { success: true };
    }

    if (isSupabaseEnabled()) {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) return { success: false, error: 'Supabase not configured.' };

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        return { success: false, error: 'Invalid email or password.' };
      }

      const sbUser = data.user;
      const meta = sbUser.user_metadata as Record<string, string> | undefined;
      const user: User = {
        id:           sbUser.id,
        email:        sbUser.email ?? email,
        name:         meta?.name ?? email.split('@')[0],
        businessName: meta?.businessName ?? 'My Restaurant',
        role:         'admin',
        createdAt:    sbUser.created_at,
      };

      const { loadWorkspaceFromSupabase } = await import('../hydration');
      const workspace = await loadWorkspaceFromSupabase(user.id, user);

      get().hydrateWorkspace(user, workspace);

      return { success: true };
    }

    // ── Local fallback (no Supabase) ──────────────────────────────────────────
    let foundUser: User | null = null;
    if (email === 'demo@smartline.io' && password === 'demo1234') {
      foundUser = DEMO_USER;
    } else {
      const accounts: { email: string; password: string; user: User }[] = JSON.parse(
        localStorage.getItem('smartline-accounts') || '[]',
      );
      foundUser = accounts.find(a => a.email === email && a.password === password)?.user ?? null;
    }
    if (!foundUser) return { success: false, error: 'Invalid email or password.' };

    setActiveUserId(foundUser.id);
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user: foundUser, isAuthenticated: true }));
    const workspace = loadWorkspaceStateLocal(foundUser.id, foundUser);
    get().hydrateWorkspace(foundUser, workspace, 'local');
    return { success: true };
  },

  async logout() {
    const cloudSession = isSupabaseEnabled() && get().user?.id !== DEMO_USER.id;
    localStorage.removeItem(AUTH_KEY);
    get().resetWorkspace();
    if (cloudSession) {
      const { supabase } = await import('@/lib/supabase/client');
      await supabase?.auth.signOut();
    }
  },

  async signup({ email, password, name, businessName }) {
    if (isSupabaseEnabled()) {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) return { success: false, error: 'Supabase not configured.' };

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, businessName } },
      });
      if (error || !data.user) {
        return { success: false, error: error?.message ?? 'Signup failed.' };
      }

      const sbUser = data.user;
      const user: User = {
        id:           sbUser.id,
        email:        sbUser.email ?? email,
        name,
        businessName,
        role:         'admin',
        createdAt:    sbUser.created_at,
      };

      // Seed the new workspace in Supabase
      const workspace = defaultWorkspace(user);
      const { upsertSettings } = await import('@/lib/supabase/queries/settings');
      const { insertMenuItem } = await import('@/lib/supabase/queries/menu');
      const { insertTable }    = await import('@/lib/supabase/queries/tables');

      await upsertSettings(workspace.settings, user.id, workspace.nextOrderNumber);
      await Promise.all(workspace.menuItems.map(item => insertMenuItem(item, user.id)));
      await Promise.all(workspace.tables.map(table => insertTable(table, user.id)));

      get().hydrateWorkspace(user, workspace);
      return { success: true };
    }

    // ── Local fallback ────────────────────────────────────────────────────────
    const accounts: { email: string; password: string; user: User }[] = JSON.parse(
      localStorage.getItem('smartline-accounts') || '[]',
    );
    if (accounts.some(a => a.email === email) || email === 'demo@smartline.io') {
      return { success: false, error: 'An account with this email already exists.' };
    }
    const newUser: User = {
      id: genId(), email, name, businessName, role: 'admin', createdAt: now(),
    };
    accounts.push({ email, password, user: newUser });
    localStorage.setItem('smartline-accounts', JSON.stringify(accounts));
    setActiveUserId(newUser.id);
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user: newUser, isAuthenticated: true }));
    const workspace = defaultWorkspace(newUser);
    get().hydrateWorkspace(newUser, workspace, 'local');
    return { success: true };
  },
});
