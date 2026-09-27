import { createClient, navigatorLock, NavigatorLockAcquireTimeoutError } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const NOT_ACQUIRED = Symbol('not-acquired');

/**
 * Cross-tab auth lock (same Web Locks coordination as the default), but a
 * "try once" request (acquireTimeout 0, used by the token auto-refresh tick
 * when another tab holds the lock) fails *outside* the lock callback.
 * The default throws inside the callback, which Firefox reports as an
 * "Uncaught (in promise)" error even though auth-js handles it.
 */
export async function authLock<R>(name: string, acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  if (acquireTimeout !== 0 || typeof globalThis.navigator?.locks?.request !== 'function') {
    return navigatorLock(name, acquireTimeout, fn);
  }
  const result = await globalThis.navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true },
    async lock => (lock ? { value: await fn() } : NOT_ACQUIRED));
  if (result === NOT_ACQUIRED) {
    throw new NavigatorLockAcquireTimeoutError(`Acquiring an exclusive Navigator LockManager lock "${name}" immediately failed`);
  }
  return result.value;
}

/**
 * Supabase client singleton.
 *
 * Will be `null` when env vars are not set (local dev without Supabase,
 * or test environment). Every caller must guard with `isSupabaseEnabled()`
 * from `@/store/flags` before using this.
 */
export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, { auth: { lock: authLock } })
    : null;
