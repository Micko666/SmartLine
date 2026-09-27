import type { BusinessSettings } from '../types';
import { addDays, minutes, restaurantClock, wallTimeInstants, weekday } from '../time/restaurantTime';
type Hours = BusinessSettings['businessHours'];

export function isWithinHours(date: string, time: string, hours: Hours): boolean {
  if (!hours?.length) return true;
  const value = minutes(time);
  const current = hours.find(day => day.dayOfWeek === weekday(date));
  const previous = hours.find(day => day.dayOfWeek === weekday(addDays(date, -1)));
  // close <= open means the window crosses midnight (equal = open 24h), same rule as SQL ordering_time_allowed.
  if (previous?.isOpen && minutes(previous.closeTime) <= minutes(previous.openTime) && value < minutes(previous.closeTime)) return true;
  if (!current?.isOpen) return false;
  const start = minutes(current.openTime), end = minutes(current.closeTime);
  return end <= start ? value >= start : value >= start && value < end;
}

export function orderingOpen(hours: Hours, timezone = 'UTC', now = new Date()): { open: true } | { open: false; reason: string } {
  const local = restaurantClock(timezone, now);
  return isWithinHours(local.date, local.time, hours) ? { open: true } : { open: false, reason: "We're closed right now. Please check our opening hours." };
}

export function orderingSlots(date: string, hours: Hours, timezone = 'UTC', now = new Date(), bufferMinutes = 30): string[] {
  const slots: string[] = [];
  for (let value = 0; value < 1440; value += 15) {
    const time = `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    if (!hours?.length && value < 360) continue;
    if (!isWithinHours(date, time, hours)) continue;
    const instants = wallTimeInstants(date, time, timezone);
    // Text schedules cannot distinguish a repeated DST hour: omit ambiguous slots.
    if (instants.length === 1 && instants[0] >= now.getTime() + bufferMinutes * 60000) slots.push(time);
  }
  return slots;
}
