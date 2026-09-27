import { useEffect } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { User } from '@/domain/types';
import { AUTH_KEY } from '@/store/workspace';
import { DEMO_USER } from '@/domain/initialData';

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    let localDemo = false;
    try { localDemo = JSON.parse(localStorage.getItem(AUTH_KEY) ?? 'null')?.user?.id === DEMO_USER.id; } catch { /* Ignore invalid local session. */ }
    if (!isSupabaseEnabled() || localDemo) {
      useStore.getState().restoreLocalSession();
      return;
    }

    let mounted = true;

    async function init() {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) {
        useStore.getState().resetWorkspace();
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

        useStore.getState().hydrateWorkspace(user, workspace);

      } else {
        useStore.getState().resetWorkspace();
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event) => {
          if (event === 'SIGNED_OUT') {
            // Reset store state directly — do NOT call logout() here because
            // logout() calls signOut() which would fire SIGNED_OUT again (loop).
            useStore.getState().resetWorkspace();
          }
        },
      );

      return () => { subscription.unsubscribe(); };
    }

    const cleanup = init().catch(() => {
      if (mounted) useStore.getState().resetWorkspace();
    });
    return () => {
      mounted = false;
      cleanup.then(fn => fn?.());
    };
  }, []);

  return <>{children}</>;
}

