/** Shared time formatting helpers used across station and admin views. */

/** Returns whole minutes elapsed since an ISO timestamp. */
export function minutesSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}
