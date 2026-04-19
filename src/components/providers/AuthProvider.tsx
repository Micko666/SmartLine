import { useEffect } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { User } from '@/domain/types';
import {
  DEFAULT_SETTINGS,
  SEED_MENU_ITEMS,
  SEED_TABLES,
  FRESH_TABLES,
  SEED_CATEGORIES,
  DEMO_USER,
} from '@/domain/initialData';

const AUTH_KEY = 'smartline-auth';
const WORKSPACE_KEY = (id: string) => `smartline-workspace-${id}`;

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!isSupabaseEnabled()) {
      _rehydrateLocal();
      return;
    }

    let mounted = true;

    async function init() {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) {
        useStore.setState({ _hasHydrated: true });
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      if (session?.user) {
        const sbUser = session.user;
        const meta = sbUser.user_metadata as Record<string, string> | undefined;
        const user: User = {
          id:           sbUser.id,
          email:        sbUser.email ?? '',
          name:         meta?.name ?? sbUser.email?.split('@')[0] ?? 'User',
          businessName: meta?.businessName ?? 'My Restaurant',
          role:         'admin',
          createdAt:    sbUser.created_at,
        };

        const { loadWorkspaceFromSupabase } = await import('@/store/hydration');
        if (!mounted) return;

        const workspace = await loadWorkspaceFromSupabase(user.id, user);
        if (!mounted) return;

        useStore.setState({ user, isAuthenticated: true, _hasHydrated: true, ...workspace });

        // Silent background tasks: local→cloud backfill (if cloud empty) + base64
        // image/logo migration. Idempotent, fail-soft, non-blocking — the user
        // never sees these. See store/autoMigrations.ts for details.
        const { runBackgroundMigrations, hasRunMigrationsThisSession } = await import('@/store/autoMigrations');
        if (!mounted) return;
        if (!hasRunMigrationsThisSession(user.id)) {
          void runBackgroundMigrations(user.id, user);
        }
      } else {
        useStore.setState({ _hasHydrated: true });
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event) => {
          if (event === 'SIGNED_OUT') {
            // Reset store state directly — do NOT call logout() here because
            // logout() calls signOut() which would fire SIGNED_OUT again (loop).
            useStore.setState({
              user: null, isAuthenticated: false,
              menuItems: [], categories: [], tables: [], orders: [], receipts: [],
              settings: DEFAULT_SETTINGS, nextOrderNumber: 1001, reservations: [],
            });
          }
        },
      );

      return () => { subscription.unsubscribe(); };
    }

    const cleanup = init();
    return () => {
      mounted = false;
      cleanup.then(fn => fn?.());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

function _rehydrateLocal() {
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (!saved) {
      useStore.setState({ _hasHydrated: true });
      return;
    }

    const auth = JSON.parse(saved);
    const restoredUser: User | null = auth?.user ?? null;
    const isAuthenticated: boolean = auth?.isAuthenticated ?? false;

    if (!restoredUser || !isAuthenticated) {
      useStore.setState({ _hasHydrated: true });
      return;
    }

    const isDemo = restoredUser.id === DEMO_USER.id;
    const defaultSettings = {
      ...DEFAULT_SETTINGS,
      businessName: isDemo ? DEFAULT_SETTINGS.businessName : restoredUser.businessName,
    };

    const raw = localStorage.getItem(WORKSPACE_KEY(restoredUser.id));
    let workspace = null;

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.state) {
          workspace = {
            menuItems:  parsed.state.menuItems  ?? (isDemo ? SEED_MENU_ITEMS  : []),
            categories: parsed.state.categories ?? SEED_CATEGORIES,
            tables:     parsed.state.tables     ?? (isDemo ? SEED_TABLES      : FRESH_TABLES),
            orders:     parsed.state.orders     ?? [],
            receipts:   parsed.state.receipts   ?? [],
            settings: {
              ...defaultSettings,
              ...parsed.state.settings,
              restaurantToken:
                parsed.state.settings?.restaurantToken || defaultSettings.restaurantToken,
            },
            nextOrderNumber: parsed.state.nextOrderNumber ?? 1001,
            reservations: (parsed.state.reservations ?? []).filter(
              (r: { expiresAt: number }) => r.expiresAt > Date.now(),
            ),
          };
        }
      } catch { /* corrupt data — fall through */ }
    }

    if (!workspace) {
      workspace = {
        menuItems:       isDemo ? SEED_MENU_ITEMS  : [],
        categories:      SEED_CATEGORIES,
        tables:          isDemo ? SEED_TABLES       : FRESH_TABLES,
        orders:          [],
        receipts:        [],
        settings:        defaultSettings,
        nextOrderNumber: 1001,
        reservations:    [],
      };
    }

    useStore.setState({
      user:            restoredUser,
      isAuthenticated: true,
      _hasHydrated:    true,
      ...workspace,
    });
  } catch {
    useStore.setState({ _hasHydrated: true });
  }
}
