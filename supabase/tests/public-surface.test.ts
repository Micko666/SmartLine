import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb, type TestDb } from './support/db';
import { createTenant, type Tenant } from './support/fixtures';

type Booking = { ok: boolean; error?: string; eventId?: string; status?: string; confirmationCode?: string };

let db: TestDb;
let t: Tenant;
let other: Tenant;
let packageId: string;

/** A date N days ahead in Europe/Podgorica (the tenant's timezone). */
function dayAhead(n: number): string {
  const d = new Date(Date.now() + n * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Podgorica' }).format(d);
}
/** Next date (>= 2 days ahead) that falls on the given weekday. */
function nextWeekday(dow: number): string {
  for (let i = 2; i < 10; i++) {
    const date = dayAhead(i);
    if (new Date(`${date}T12:00:00Z`).getUTCDay() === dow) return date;
  }
  throw new Error('unreachable');
}

function booking(extra: Record<string, unknown> = {}) {
  return {
    p_restaurant_token: t.token, p_client_request_id: randomUUID(), p_date: nextWeekday(3), p_time_slot: '19:00',
    p_type: 'reservation', p_customer_name: 'Guest', p_customer_phone: '+382 67 123 456', p_customer_email: '',
    p_guest_count: 2, p_package_id: null, p_notes: '', ...extra,
  };
}
const submit = (args: Record<string, unknown>) => db.rpc<Booking>('anon', 'submit_booking', args);

beforeAll(async () => {
  db = await createTestDb();
  t = await createTenant(db, 'pub', { calendar_settings: JSON.stringify({ maxEventsPerDay: 2, requireApproval: true, advanceBookingDays: 30 }) });
  other = await createTenant(db, 'other');
  [{ id: packageId }] = await db.sql<{ id: string }>(`INSERT INTO event_packages(user_id, name, min_guests, max_guests) VALUES ($1,'Party',10,20) RETURNING id`, [t.userId]);
  await db.sql(`INSERT INTO employees(user_id, name, role, phone, email) VALUES ($1,'Chef Ana','Chef','+38269000000','ana@private.test')`, [t.userId]);
  await db.sql(`UPDATE business_settings SET stations='[{"id":"legacy","pin":"9999"}]' WHERE user_id=$1`, [t.userId]);
  await db.sql(`UPDATE menu_items SET cost_per_serving=3.21, recipe='[{"ingredientId":"x","quantity":1}]', sales_count=77 WHERE user_id=$1`, [t.userId]);
  await db.sql(`INSERT INTO shifts(user_id, date, name, start_time, end_time) VALUES ($1,'2020-01-01','Ancient','09:00','17:00'), ($1,$2,'Soon','09:00','17:00')`, [t.userId, dayAhead(3)]);
});
afterAll(async () => { await db?.close(); });

describe('booking: server decides status and type', () => {
  it('cannot self-approve: status follows requireApproval', async () => {
    const r = await submit(booking());
    expect(r.ok).toBe(true);
    await expect(submit({ ...booking(), p_status: 'approved' })).rejects.toThrow(/does not exist/);
    expect(r.status).toBe('pending');
    expect(r.confirmationCode).toMatch(/^[0-9A-F]{8}$/);
  });

  it('the old signature that accepted p_status is gone', async () => {
    const rows = await db.sql<{ a: string }>(`SELECT pg_get_function_identity_arguments(oid) a FROM pg_proc WHERE proname='submit_booking'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].a).not.toContain('p_status');
  });

  it.each(['closure', 'takeaway', 'delivery', 'approved', ''])('rejects customer booking type %s', async type => {
    expect((await submit(booking({ p_type: type }))).ok).toBe(false);
  });

  it.each([
    ['past date', { p_date: '2020-01-01' }],
    ['too far ahead', { p_date: dayAhead(60) }],
    ['closed Sunday', { p_date: nextWeekday(0) }],
    ['before opening', { p_time_slot: '08:00' }],
    ['last hour before close', { p_time_slot: '21:30' }],
    ['off-grid time', { p_time_slot: '19:15' }],
    ['malformed date', { p_date: '31.12.2030' }],
    ['zero guests', { p_guest_count: 0 }],
    ['negative guests', { p_guest_count: -3 }],
    ['absurd guests', { p_guest_count: 5000 }],
    ['missing name', { p_customer_name: ' ' }],
    ['missing phone', { p_customer_phone: 'abc' }],
    ['huge notes', { p_notes: 'x'.repeat(3000) }],
    ['foreign package', { p_package_id: randomUUID() }],
    ['package guests below min', { p_type: 'private_event', p_package_id: 'PKG', p_guest_count: 5 }],
  ])('rejects %s', async (_label, extra) => {
    const args = { ...extra } as Record<string, unknown>;
    if (args.p_package_id === 'PKG') args.p_package_id = packageId;
    expect((await submit(booking(args))).ok).toBe(false);
  });

  it('accepts a package booking inside the guest range', async () => {
    expect((await submit(booking({ p_type: 'private_event', p_package_id: packageId, p_guest_count: 12, p_date: nextWeekday(4) }))).ok).toBe(true);
  });

  it('enforces maxEventsPerDay on the server', async () => {
    const date = nextWeekday(5);
    expect((await submit(booking({ p_date: date }))).ok).toBe(true);
    expect((await submit(booking({ p_date: date }))).ok).toBe(true);
    const third = await submit(booking({ p_date: date }));
    expect(third.ok).toBe(false);
    expect(third.error).toMatch(/Fully booked/);
  });

  it('an approved closure blocks the date', async () => {
    const date = nextWeekday(2);
    await db.sql(`INSERT INTO calendar_events(user_id, date, time_slot, type, status) VALUES ($1,$2,'00:00','closure','approved')`, [t.userId, date]);
    expect((await submit(booking({ p_date: date }))).ok).toBe(false);
  });

  it('is idempotent per client request id', async () => {
    const args = booking({ p_date: nextWeekday(1) });
    const [a, b] = await Promise.all([submit(args), submit(args)]);
    expect(a.eventId).toBe(b.eventId);
  });
});

describe('booking lookup is privacy-safe', () => {
  it('needs phone AND confirmation code; returns no customer PII', async () => {
    const r = await submit(booking({ p_date: nextWeekday(6), p_customer_name: 'Secret Name' }));
    const ok = await db.rpc<{ bookings: unknown[] }>('anon', 'lookup_booking_status', { p_restaurant_token: t.token, p_phone: '+38267123456', p_confirmation_code: r.confirmationCode });
    expect(ok.bookings).toHaveLength(1);
    expect(JSON.stringify(ok)).not.toContain('Secret Name');
    const wrongCode = await db.rpc<{ bookings: unknown[] }>('anon', 'lookup_booking_status', { p_restaurant_token: t.token, p_phone: '+38267123456', p_confirmation_code: '00000000' });
    const wrongPhone = await db.rpc<{ bookings: unknown[] }>('anon', 'lookup_booking_status', { p_restaurant_token: t.token, p_phone: '+38260000000', p_confirmation_code: r.confirmationCode });
    const otherRestaurant = await db.rpc<{ bookings: unknown[] }>('anon', 'lookup_booking_status', { p_restaurant_token: other.token, p_phone: '+38267123456', p_confirmation_code: r.confirmationCode });
    expect([wrongCode.bookings, wrongPhone.bookings, otherRestaurant.bookings]).toEqual([[], [], []]);
  });

  it('get_booking_data exposes no customer data, ids or shift templates', async () => {
    const data = await db.rpc<Record<string, unknown>>('anon', 'get_booking_data', { p_restaurant_token: t.token });
    const text = JSON.stringify(data);
    for (const leaked of ['Guest', '+382', 'customer', 'shiftTemplates', 'weekTemplate', t.userId]) expect(text).not.toContain(leaked);
  });
});

describe('public data minimization', () => {
  it('customer menu contains no PIN, station config, cost, recipe, sales or owner id', async () => {
    const menu = await db.rpc<Record<string, unknown>>('anon', 'get_customer_menu', { p_restaurant_token: t.token });
    const text = JSON.stringify(menu);
    for (const leaked of ['pin', 'pin_hash', 'stations', 'cost_per_serving', 'recipe', 'sales_count', 'userId', t.userId, '9999', '3.21']) {
      expect(text, leaked).not.toContain(leaked);
    }
    expect((menu.menuItems as unknown[]).length).toBeGreaterThan(0);
  });

  it('public roster has no phone/email/user_id and no old shifts', async () => {
    const roster = await db.rpc<{ employees: Record<string, unknown>[]; shifts: Record<string, unknown>[] }>('anon', 'get_roster_data', { p_restaurant_token: t.token });
    const text = JSON.stringify(roster);
    for (const leaked of ['+38269000000', 'ana@private.test', 'phone', 'email', 'user_id', t.userId]) expect(text).not.toContain(leaked);
    expect(roster.employees[0]).toMatchObject({ name: 'Chef Ana', role: 'Chef' });
    expect(roster.shifts.map(s => s.name)).toEqual(['Soon']);
  });
});

describe('privileges (SECURITY DEFINER hardening)', () => {
  const PUBLIC_API = ['atomic_checkout', 'get_customer_menu', 'get_booking_data', 'submit_booking', 'lookup_booking_status', 'get_roster_data', 'get_order_status', 'get_receipt_by_id', 'station_public_config', 'station_login', 'station_logout', 'station_get_orders', 'station_advance_order', 'station_adjust_prep_time', 'station_log_kitchen_event', 'station_set_table_status', 'station_get_context'];
  const OWNER_API = ['advance_order', 'cancel_order', 'adjust_stock', 'patch_settings', 'list_stations', 'upsert_station', 'delete_station'];

  it('anon can execute exactly the public allow-list', async () => {
    const rows = await db.sql<{ proname: string }>(`SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('anon', p.oid, 'EXECUTE') ORDER BY 1`);
    expect(rows.map(r => r.proname).sort()).toEqual([...PUBLIC_API].sort());
  });

  it('authenticated can execute exactly public + owner allow-lists', async () => {
    const rows = await db.sql<{ proname: string }>(`SELECT DISTINCT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE') ORDER BY 1`);
    expect(rows.map(r => r.proname).sort()).toEqual([...PUBLIC_API, ...OWNER_API].sort());
  });

  it('internal helpers such as transition_order_internal are not callable by API roles', async () => {
    await expect(db.as('anon', `SELECT transition_order_internal($1, gen_random_uuid(), 'paid', 'cancelled', 'x')`, [t.userId])).rejects.toThrow(/permission denied/);
  });

  it('every SECURITY DEFINER function pins search_path', async () => {
    const rows = await db.sql<{ proname: string }>(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prosecdef AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')`);
    expect(rows).toEqual([]);
  });

  it('a function created after 021 is not executable by PUBLIC by default', async () => {
    await db.sql(`CREATE FUNCTION public.zz_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
    const [r] = await db.sql<{ ok: boolean }>(`SELECT has_function_privilege('anon', 'public.zz_probe()', 'EXECUTE') ok`);
    await db.sql(`DROP FUNCTION public.zz_probe()`);
    expect(r.ok).toBe(false);
  });
});
