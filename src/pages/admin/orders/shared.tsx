/** Shared constants/helpers extracted from Orders.tsx (behavior-preserving split). */
import { addDays, formatScheduled, restaurantDate } from '@/domain/time/restaurantTime';
import type { OrderStatus, Order, KitchenEventType } from '@/domain/types';


export const TABS: { label: string; value: OrderStatus | 'all' | 'tables' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Paid', value: 'paid' },
  { label: 'Preparing', value: 'preparing' },
  { label: 'Ready', value: 'ready' },
  { label: 'Completed', value: 'completed' },
  { label: 'Tables', value: 'tables' },
];

export const ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

export function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : `${m}m ago`;
}

/** "YYYY-MM-DD HH:MM" (restaurant wall clock) -> "Today · 18:30" relative to the restaurant's day. */
export function formatScheduledFor(scheduledFor: string, timezone: string): string {
  const [dateStr, timeStr] = scheduledFor.split(' ');
  if (!dateStr || !timeStr) return scheduledFor;
  return formatScheduled(dateStr, timeStr, timezone);
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayLabel(key: string, timezone: string) {
  const today = restaurantDate(timezone);
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  return new Intl.DateTimeFormat([], { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${key}T12:00:00Z`));
}

export const PAYMENT_STATUS_LABEL: Record<NonNullable<Order['paymentStatus']>, string> = {
  unpaid: 'Payment due', paid: 'Paid', refunded: 'Refunded', legacy_unverified: 'Payment not verified',
};

// ─── Kitchen Event Modal ──────────────────────────────────────────────────────

export const EVENT_TYPE_CONFIG: Record<KitchenEventType, { label: string; desc: string; color: string }> = {
  waste:  { label: 'Waste',  desc: 'Food discarded or spoiled',      color: 'border-destructive/50 bg-destructive/5 text-destructive' },
  remake: { label: 'Remake', desc: 'Item needs to be prepared again', color: 'border-warning/50 bg-warning/5 text-warning' },
  delay:  { label: 'Delay',  desc: 'Preparation taking longer',       color: 'border-info/50 bg-info/5 text-info' },
  note:   { label: 'Note',   desc: 'General kitchen observation',      color: 'border-border bg-muted/30 text-foreground' },
};
