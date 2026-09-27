/** Shared constants/helpers extracted from Calendar.tsx (behavior-preserving split). */
import type { CalendarEventType } from '@/domain/types';
import { localDateKey } from '@/domain/time/restaurantTime';


// ─── Helpers ──────────────────────────────────────────────────────────────────

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/** Device-local calendar day (see localDateKey: toISOString shifted local midnight to the previous UTC day). */
export const isoDate = localDateKey;

export function today()          { return isoDate(new Date()); }

export function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

export function shiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  return Math.round((end - start) / 60 * 10) / 10;
}

export const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning/15 text-warning border-warning/30',
  approved:  'bg-success/15 text-success border-success/30',
  rejected:  'bg-destructive/15 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
  completed: 'bg-primary/10 text-primary border-primary/20',
};

export const TYPE_EMOJI: Record<CalendarEventType, string> = {
  reservation: '🪑', private_event: '🎉', closure: '🔒', takeaway: '🥡', delivery: '🚚',
};

export const TYPE_LABEL: Record<CalendarEventType, string> = {
  reservation: 'Reservation', private_event: 'Private Event',
  closure: 'Closure / Blocked', takeaway: 'Takeaway', delivery: 'Delivery',
};

export const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316',
  '#eab308','#22c55e','#14b8a6','#0ea5e9','#64748b',
];

// ─── Week Template Editor ─────────────────────────────────────────────────────

export const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// JS dayOfWeek: 0=Sun…6=Sat. Our display order is Mon(1)…Sun(0).
export const DISPLAY_DOW: Array<0|1|2|3|4|5|6> = [1,2,3,4,5,6,0];

// ─── Main page ─────────────────────────────────────────────────────────────────

export type Tab = 'bookings' | 'roster';

export type RosterView = 'grid' | 'log';
