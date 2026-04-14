import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase client singleton.
 *
 * Will be `null` when env vars are not set (local dev without Supabase,
 * or test environment). Every caller must guard with `isSupabaseEnabled()`
 * from `@/store/flags` before using this.
 */
export const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey)
    : null;
