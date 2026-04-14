/**
 * Runtime flag: is Supabase configured?
 *
 * Returns true only when VITE_SUPABASE_URL is present in the environment.
 * In Vitest this env var is absent, so every `if (isSupabaseEnabled())` guard
 * short-circuits and no Supabase calls are made — tests need no mocks.
 */
export function isSupabaseEnabled(): boolean {
  return (
    typeof import.meta.env?.VITE_SUPABASE_URL === 'string' &&
    import.meta.env.VITE_SUPABASE_URL.length > 0
  );
}
