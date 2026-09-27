/**
 * Store runtime shared by all slices: ids/clock, the active local workspace,
 * the local-vs-Supabase persistence switch, and localStorage persistence.
 */
import { toast } from 'sonner';
import { DEMO_USER } from '../domain/initialData';
import { isSupabaseEnabled } from './flags';
import { saveWorkspaceStateLocal } from './workspace';
import type { AppState } from './types';

export type StoreSet = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
export type StoreGet = () => AppState;

export const genId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const RESERVATION_TTL_MS = 5 * 60 * 1000;

// Active local workspace; set by login and refresh through the same action.
let activeUser: string | null = null;
export function activeUserId(): string | null { return activeUser; }
export function setActiveUserId(id: string | null): void { activeUser = id; }

/** Supabase is the persistence layer unless disabled or the local demo account is active. */
export function usesSupabasePersistence(): boolean {
  return isSupabaseEnabled() && activeUser !== DEMO_USER.id;
}

/** Persist the workspace snapshot to localStorage (local/demo mode only). */
export function persistLocal(get: StoreGet): void {
  if (usesSupabasePersistence() || !activeUser) return;
  try { saveWorkspaceStateLocal(activeUser, get()); }
  catch { toast.error('Local storage is full. Your latest changes could not be saved.'); }
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
