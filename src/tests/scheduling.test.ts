import { describe, it, expect } from 'vitest';
import { restaurantDate, wallTimeInstants } from '@/domain/time/restaurantTime';
import { orderingSlots, orderingOpen } from '@/domain/ordering/scheduling';
import type { WorkingDay } from '@/domain/types';
const hours: WorkingDay[] = Array.from({ length: 7 }, (_, day) => ({ dayOfWeek: day as WorkingDay['dayOfWeek'], isOpen: day !== 0, openTime: '18:00', closeTime: '02:00' }));
describe('restaurant scheduling', () => {
  it('uses Podgorica date across the UTC boundary', () => expect(restaurantDate('Europe/Podgorica', new Date('2026-06-01T22:30Z'))).toBe('2026-06-02'));
  it('rejects nonexistent DST spring times and exposes autumn ambiguity', () => {
    expect(wallTimeInstants('2026-03-29', '02:30', 'Europe/Podgorica')).toHaveLength(0);
    expect(wallTimeInstants('2026-10-25', '02:30', 'Europe/Podgorica')).toHaveLength(2);
  });
  it('keeps Saturday overnight service open on closed Sunday', () => {
    expect(orderingOpen(hours, 'Europe/Podgorica', new Date('2026-09-26T23:00Z')).open).toBe(true);
    expect(orderingOpen(hours, 'Europe/Podgorica', new Date('2026-09-27T16:00Z')).open).toBe(false);
  });
  it('excludes close boundary and respects the buffer after midnight', () => {
    const slots = orderingSlots('2026-09-27', hours, 'Europe/Podgorica', new Date('2026-09-26T23:15Z'));
    expect(slots).toEqual(['01:45']);
    expect(orderingSlots('2026-09-27', hours, 'Europe/Podgorica', new Date('2026-09-26T23:31Z'))).toEqual([]);
  });
  it('offers next-day hours but no past dates', () => {
    expect(orderingSlots('2026-09-29', hours, 'Europe/Podgorica', new Date('2026-09-28T17:00Z'))).toContain('18:00');
    expect(orderingSlots('2026-09-27', hours, 'Europe/Podgorica', new Date('2026-09-28T17:00Z'))).toEqual([]);
  });
});

import { localDateKey, restaurantDayKey, restaurantHour } from '@/domain/time/restaurantTime';
describe('restaurant day helpers', () => {
  it('buckets an order placed at 00:30 Podgorica time into that local day', () => {
    expect(restaurantDayKey('2026-09-27T22:30:00Z', 'Europe/Podgorica')).toBe('2026-09-28');
    expect(restaurantHour('2026-09-27T22:30:00Z', 'Europe/Podgorica')).toBe(0);
  });
  it('localDateKey keeps the local calendar day at local midnight', () => {
    expect(localDateKey(new Date(2026, 8, 28, 0, 0, 0))).toBe('2026-09-28');
  });
});
