/** Public customers poll the minimized RPC; private table SELECT remains closed. */
import { useEffect } from 'react';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import { fetchRestaurantByToken } from '../queries/public';
export function useMenuSubscription(restaurantToken: string) {
  useEffect(() => {
    if (!isSupabaseEnabled() || !restaurantToken) return;
    let disposed = false;
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      const data = await fetchRestaurantByToken(restaurantToken).catch(() => null);
      if (!disposed && data && useStore.getState().settings.restaurantToken === restaurantToken) useStore.getState().hydrateCustomerContext(data);
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [restaurantToken]);
}
