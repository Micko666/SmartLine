/**
 * Silent, idempotent background tasks that keep a tenant's cloud workspace
 * in sync without the owner ever touching an "infrastructure" button.
 *
 * Called once per authenticated bootstrap (from AuthProvider on refresh and
 * from store.login on fresh sign-in). Each task is:
 *
 *   - idempotent: re-running is safe and cheap (self-detecting no-ops)
 *   - non-blocking: scheduled via requestIdleCallback / setTimeout so login
 *     UI paints first; the user never waits on these
 *   - fail-soft: errors are swallowed with console.warn; one failure never
 *     blocks another task or the app
 *   - per-tenant: every DB write goes through the authenticated session,
 *     so RLS enforces that writes land under the owner's user_id only
 *
 * Tasks:
 *   1. ensureCloudWorkspace     — if cloud is empty but local has data, push
 *                                  it up (never overwrites non-empty cloud)
 *   2. migrateBase64Images      — convert any data:-URI images in menu_items
 *                                  to Storage objects in resumable batches
 *   3. migrateBase64Logo        — same, for business_settings.logo_url
 */

import { isSupabaseEnabled } from './flags';
import type { User } from '@/domain/types';
import { useStore } from './index';

/** One-shot guard: don't re-run migrations in the same session. */
const RAN_KEY = 'smartline-migrations-ran-v1';
let _inFlight: Promise<void> | null = null;

export function runBackgroundMigrations(userId: string, user: User): Promise<void> {
  if (!isSupabaseEnabled() || !userId) return Promise.resolve();
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    // Yield to the paint first — the user should see a responsive UI before
    // we start hammering Storage with uploads.
    await idle();

    try {
      await ensureCloudWorkspace(userId, user);
    } catch (err) {
      console.warn('[autoMigrations] ensureCloudWorkspace failed:', err);
    }

    try {
      await migrateBase64Images(userId);
    } catch (err) {
      console.warn('[autoMigrations] migrateBase64Images failed:', err);
    }

    try {
      await migrateBase64Logo(userId);
    } catch (err) {
      console.warn('[autoMigrations] migrateBase64Logo failed:', err);
    }

    try {
      sessionStorage.setItem(RAN_KEY, userId);
    } catch { /* quota / private mode — fine */ }
  })();

  return _inFlight;
}

/** Returns true if migrations have already completed once this session. */
export function hasRunMigrationsThisSession(userId: string): boolean {
  try {
    return sessionStorage.getItem(RAN_KEY) === userId;
  } catch {
    return false;
  }
}

// ── Task 1: local → cloud sync ───────────────────────────────────────────────

/**
 * If cloud is empty but the local Zustand store has data (the owner was
 * working offline or in demo mode before connecting Supabase), push local
 * data up. Only runs when cloud is truly empty — never overwrites anything.
 */
async function ensureCloudWorkspace(userId: string, user: User): Promise<void> {
  const { loadWorkspaceFromSupabase, pushLocalToSupabase } = await import('./hydration');

  const cloud = await loadWorkspaceFromSupabase(userId, user);
  const cloudEmpty =
    cloud.menuItems.length === 0 &&
    cloud.tables.length === 0 &&
    cloud.employees.length === 0;
  if (!cloudEmpty) return;

  const local = useStore.getState();
  const localHasData =
    local.menuItems.length > 0 ||
    local.tables.length > 0 ||
    local.employees.length > 0;
  if (!localHasData) return;

  await pushLocalToSupabase({
    menuItems:        local.menuItems,
    tables:           local.tables,
    employees:        local.employees,
    shifts:           local.shifts,
    // Preserve the cloud token (assigned at signup) — never overwrite with local.
    settings:         { ...local.settings, restaurantToken: cloud.settings.restaurantToken },
    calendarSettings: local.calendarSettings,
    nextOrderNumber:  local.nextOrderNumber,
  }, userId);

  // Reflect the just-synced data back into the store so the current session
  // is consistent with cloud.
  const refreshed = await loadWorkspaceFromSupabase(userId, user);
  useStore.setState({ ...refreshed, stations: refreshed.settings.stations ?? [] });
}

// ── Task 2: base64 menu images → Storage ─────────────────────────────────────

const BATCH_SIZE = 3;

async function migrateBase64Images(userId: string): Promise<void> {
  const items = useStore.getState().menuItems;
  const targets = items.filter(i =>
    (typeof i.imageUrl === 'string'     && i.imageUrl.startsWith('data:')) ||
    (typeof i.thumbnailUrl === 'string' && i.thumbnailUrl.startsWith('data:')),
  );
  if (targets.length === 0) return;

  const { dataUriToBlob, uploadMenuImage } = await import('@/lib/supabase/storage');
  const { updateMenuItemRow } = await import('@/lib/supabase/queries/menu');

  // Resumable: process in small batches yielding between each so the main
  // thread stays responsive. A page refresh / session end simply leaves the
  // remaining items for the next login — they're self-detected by startsWith.
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async item => {
      const src = item.imageUrl?.startsWith('data:')
        ? item.imageUrl
        : item.thumbnailUrl?.startsWith('data:')
          ? item.thumbnailUrl
          : null;
      if (!src) return;
      const blob = dataUriToBlob(src);
      if (!blob) return;

      const { imageUrl, thumbnailUrl } = await uploadMenuImage(blob, userId, item.id);
      if (!imageUrl || !thumbnailUrl) return;

      // Persist to cloud first so other devices see it, then update local store.
      await updateMenuItemRow(item.id, { image_url: imageUrl, thumbnail_url: thumbnailUrl });
      useStore.setState(s => ({
        menuItems: s.menuItems.map(m =>
          m.id === item.id ? { ...m, imageUrl, thumbnailUrl } : m,
        ),
      }));
    }));
    await idle();
  }
}

// ── Task 3: base64 logo → Storage ────────────────────────────────────────────

async function migrateBase64Logo(userId: string): Promise<void> {
  const settings = useStore.getState().settings;
  if (!settings?.logoUrl?.startsWith('data:')) return;

  const { dataUriToBlob, uploadLogo } = await import('@/lib/supabase/storage');
  const { upsertSettings } = await import('@/lib/supabase/queries/settings');

  const blob = dataUriToBlob(settings.logoUrl);
  if (!blob) return;
  const url = await uploadLogo(blob, userId);
  if (!url) return;

  const next = { ...settings, logoUrl: url };
  await upsertSettings(next, userId);
  useStore.setState({ settings: next });
}

// ── Scheduling helper ────────────────────────────────────────────────────────

function idle(): Promise<void> {
  return new Promise(resolve => {
    if (typeof window === 'undefined') return resolve();
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 50);
  });
}
