/** Restaurant wall-clock primitives. Date strings never depend on the device zone. */
const formatters = new Map<string, Intl.DateTimeFormat>();
export function restaurantClock(timezone = 'UTC', now = new Date()) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timezone, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function restaurantDate(timezone = 'UTC', now = new Date()): string { return restaurantClock(timezone, now).date; }
export function addDays(date: string, days: number): string { return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10); }
export function weekday(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
export function minutes(time: string): number { const [h, m] = time.split(':').map(Number); return h * 60 + m; }

/** Zero results for DST gaps, two for repeated wall times. Callers explicitly choose policy. */
export function wallTimeInstants(date: string, time: string, timezone = 'UTC'): number[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
  const wall = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 10) !== date) return [];
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const sample = wall + delta;
    const local = restaurantClock(timezone, new Date(sample));
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - sample);
  }
  return [...offsets].map(offset => wall - offset).filter(instant => {
    const local = restaurantClock(timezone, new Date(instant));
    return local.date === date && local.time === time;
  }).sort((a, b) => a - b);
}

export function formatScheduled(date: string, time: string, timezone = 'UTC', now = new Date()): string {
  const today = restaurantDate(timezone, now);
  const label = date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' :
    new Intl.DateTimeFormat('en', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
  return `${label} · ${time}`;
}
