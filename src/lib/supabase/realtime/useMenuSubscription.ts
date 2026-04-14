/**
 * Real-time menu stock subscription for the customer-facing menu.
 *
 * Subscribes to UPDATE events on menu_items filtered by user_id (resolved
 * from the restaurantToken URL param). When stock or status changes remotely
 * (e.g. admin sells out an item), the customer menu reflects it instantly
 * without a page refresh.
 *
 * Uses the public anon key — no auth required. The RLS policy allows
 * public reads of active items, which is all this subscription needs.
 */
import { useEffect } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import { supabase } from '../client';

export function useMenuSubscription(userId: string | null) {
  useEffect(() => {
    if (!isSupabaseEnabled() || !userId || !supabase) return;

    const channel = supabase
      .channel(`menu:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'menu_items', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          useStore.setState(s => ({
            menuItems: s.menuItems.map(item =>
              item.id === row.id
                ? {
                    ...item,
                    stock:    row.stock != null ? Number(row.stock) : null,
                    status:   (row.status as typeof item.status) ?? item.status,
                    updatedAt: row.updated_at as string,
                  }
                : item,
            ),
          }));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId]);
}
