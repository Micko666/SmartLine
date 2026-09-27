import { afterEach, describe, expect, it, vi } from 'vitest';
import { authLock } from '@/lib/supabase/client';

type Request = (name: string, opts: { ifAvailable?: boolean }, cb: (lock: object | null) => Promise<unknown>) => Promise<unknown>;

function fakeLocks(held: boolean) {
  const request = vi.fn<Request>((_name, _opts, cb) => cb(held ? null : {}));
  vi.stubGlobal('navigator', { ...globalThis.navigator, locks: { request } });
  return request;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('authLock (Supabase auth cross-tab lock)', () => {
  it('runs fn when the lock is free', async () => {
    fakeLocks(false);
    await expect(authLock('lock:x', 0, async () => 42)).resolves.toBe(42);
  });

  it('a held lock with timeout 0 rejects with an acquire-timeout error, outside the lock callback, without running fn', async () => {
    const request = fakeLocks(true);
    const fn = vi.fn(async () => 1);
    const err = await authLock('lock:x', 0, fn).catch(e => e);
    expect(err.isAcquireTimeout).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    // The callback itself resolved (no rejection inside the Web Locks callback).
    await expect(request.mock.results[0].value).resolves.toBeTypeOf('symbol');
  });
});
