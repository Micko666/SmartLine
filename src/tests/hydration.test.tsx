import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import AuthProvider from '@/components/providers/AuthProvider';
import { useStore, _resetStoreForTesting } from '@/store';
import { DEMO_USER } from '@/domain/initialData';
import { buildStation } from '@/domain/stations';
import { AUTH_KEY, WORKSPACE_KEY, WORKSPACE_KEYS, defaultWorkspace, emptyWorkspace, loadWorkspaceStateLocal, workspaceSnapshot, type WorkspaceSnapshot } from '@/store/workspace';

const mocks = vi.hoisted(() => ({ enabled: false, load: vi.fn(), signOut: vi.fn(), authChange: vi.fn() }));
vi.mock('@/store/flags', () => ({ isSupabaseEnabled: () => mocks.enabled }));
vi.mock('@/store/hydration', () => ({ loadWorkspaceFromSupabase: mocks.load }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: {
  getSession: async () => ({ data: { session: { user: { id: 'owner-cloud', email: 'owner@example.test', created_at: new Date().toISOString() } } } }),
  onAuthStateChange: mocks.authChange,
  signOut: mocks.signOut,
} } }));
vi.mock('@/services/workspaceService', () => ({
  saveStation: vi.fn(async (station: Record<string, unknown>) => ({ ...station, pin: '', hasPin: 'pin' in station })),
}));

function fullWorkspace(): WorkspaceSnapshot {
  const state = defaultWorkspace(DEMO_USER);
  const createdAt = new Date().toISOString();
  const station = buildStation({ name: 'Kitchen', role: 'kitchen' });
  state.stations = [station]; state.settings.stations = [station];
  state.orders = [{ id: 'order', orderNumber: 1001, tableId: state.tables[0].id, tableName: 'Table 1', items: [], status: 'placed', subtotal: 1, taxRate: 0, taxAmount: 0, total: 1, paymentMethod: 'cash', notes: '', estimatedPrepTime: 10, prepTimeAdjustment: 0, createdAt, updatedAt: createdAt, paidAt: createdAt }];
  state.receipts = [{ id: 'receipt', orderId: 'order', orderNumber: 1001, tableId: state.tables[0].id, tableName: 'Table 1', restaurantName: 'Demo', items: [], subtotal: 1, taxRate: 0, taxAmount: 0, total: 1, paymentMethod: 'cash', createdAt }];
  state.nextOrderNumber = 1002;
  state.reservations = [{ id: 'reservation', sessionId: 'session', items: [], expiresAt: Date.now() + 60000 }];
  state.kitchenEvents = [{ id: 'event', orderId: 'order', orderNumber: 1001, type: 'note', notes: 'Keep this', createdAt }];
  state.decorations = [{ id: 'decoration', type: 'plant', x: 1, y: 2, w: 3, h: 4, rotation: 0 }];
  state.calendarEvents = [{ id: 'booking', date: '2026-10-01', timeSlot: '18:00', type: 'reservation', status: 'pending', customerName: 'Guest', customerPhone: '123', customerEmail: '', guestCount: 2, notes: '', createdBy: 'customer', createdAt, updatedAt: createdAt }];
  state.eventPackages = [{ id: 'package', name: 'Dinner', emoji: '', description: '', minGuests: 1, maxGuests: 10, duration: 1, details: '', active: true, createdAt }];
  state.calendarSettings = { ...state.calendarSettings, maxEventsPerDay: 7, shiftTemplates: [{ id: 'template', name: 'Day', startTime: '09:00', endTime: '17:00', role: 'Chef', color: '#123456' }] };
  state.employees = [{ id: 'employee', name: 'Chef', role: 'Chef', color: '#123456', active: true, createdAt }];
  state.shifts = [{ id: 'shift', date: '2026-10-01', name: 'Day', startTime: '09:00', endTime: '17:00', color: '#123456', assignments: [{ employeeId: 'employee', role: 'Chef' }], minStaff: 1, notes: '', createdAt }];
  return state;
}

beforeEach(() => {
  mocks.enabled = false;
  mocks.authChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  _resetStoreForTesting();
  useStore.getState().resetWorkspace();
});
afterEach(cleanup);

describe('canonical workspace hydration', () => {
  it('refresh followed by an ordinary write preserves every tenant slice', () => {
    const saved = fullWorkspace();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user: DEMO_USER, isAuthenticated: true }));
    localStorage.setItem(WORKSPACE_KEY(DEMO_USER.id), JSON.stringify({ state: saved }));
    render(<AuthProvider><span>App</span></AuthProvider>);
    for (const key of WORKSPACE_KEYS) expect(useStore.getState()[key], key).toEqual(saved[key]);
    useStore.getState().addCategory('New category');
    const persisted = loadWorkspaceStateLocal(DEMO_USER.id, DEMO_USER);
    for (const key of WORKSPACE_KEYS.filter(key => key !== 'categories')) expect(persisted[key], key).toEqual(saved[key]);
    expect(persisted.categories).toContain('New category');
  });

  it('login and refresh use the same deserializer, including legacy settings', async () => {
    const saved = fullWorkspace();
    localStorage.setItem(WORKSPACE_KEY(DEMO_USER.id), JSON.stringify({ state: { ...saved, stations: undefined, calendarSettings: { maxEventsPerDay: 4 } } }));
    await useStore.getState().login('demo@smartline.io', 'demo1234');
    const login = workspaceSnapshot(useStore.getState());
    useStore.getState().resetWorkspace();
    useStore.getState().restoreLocalSession();
    expect(workspaceSnapshot(useStore.getState())).toEqual(login);
    expect(login.stations).toEqual(saved.stations);
    expect(login.calendarSettings.shiftTemplates).toEqual([]);
  });

  it('legacy local orders saved with status "paid" load as "placed" (payment state untouched)', () => {
    const saved = fullWorkspace();
    const legacy = { ...saved, orders: saved.orders.map(o => ({ ...o, status: 'paid' })) };
    localStorage.setItem(WORKSPACE_KEY(DEMO_USER.id), JSON.stringify({ state: legacy }));
    const loaded = loadWorkspaceStateLocal(DEMO_USER.id, DEMO_USER);
    expect(loaded.orders[0].status).toBe('placed');
    expect(loaded.orders[0].paymentStatus).toBeUndefined();
  });

  it('Supabase refresh restores stations before the next station write', async () => {
    mocks.enabled = true;
    const saved = fullWorkspace();
    mocks.load.mockResolvedValue({ ...saved, stations: [] });
    render(<AuthProvider><span>App</span></AuthProvider>);
    await waitFor(() => expect(useStore.getState().user?.id).toBe('owner-cloud'));
    expect(useStore.getState().stations).toEqual(saved.settings.stations);
    const next = buildStation({ name: 'Bar', role: 'bar' });
    expect(await useStore.getState().addStation(next)).toBe(true);
    expect(useStore.getState().stations.map(station => station.name)).toEqual(['Kitchen', 'Bar']);
    expect(useStore.getState().settings.stations).toEqual(useStore.getState().stations);
  });

  it('logout clears every tenant slice and retains actions', async () => {
    useStore.getState().hydrateWorkspace(DEMO_USER, fullWorkspace(), 'local');
    await useStore.getState().logout();
    expect(workspaceSnapshot(useStore.getState())).toEqual(emptyWorkspace());
    expect(useStore.getState().user).toBeNull();
    expect(typeof useStore.getState().checkout).toBe('function');
    // If a tenant field is added to AppState without joining the schema, fail here.
    const dataKeys = Object.keys(useStore.getState()).filter(key => typeof useStore.getState()[key as keyof ReturnType<typeof useStore.getState>] !== 'function' && !['_hasHydrated', 'user', 'isAuthenticated'].includes(key));
    expect(dataKeys.sort()).toEqual([...WORKSPACE_KEYS].sort());
  });

  it('SIGNED_OUT uses the same complete reset as logout', async () => {
    mocks.enabled = true;
    mocks.load.mockResolvedValue(fullWorkspace());
    render(<AuthProvider><span>App</span></AuthProvider>);
    await waitFor(() => expect(mocks.authChange).toHaveBeenCalled());
    const callback = mocks.authChange.mock.calls.at(-1)?.[0];
    await callback('SIGNED_OUT');
    expect(workspaceSnapshot(useStore.getState())).toEqual(emptyWorkspace());
  });

  it('demo refresh persists locally when Supabase is configured', async () => {
    mocks.enabled = true;
    await useStore.getState().login('demo@smartline.io', 'demo1234');
    useStore.getState().addCategory('Demo only');
    useStore.getState().resetWorkspace();
    render(<AuthProvider><span>App</span></AuthProvider>);
    expect(useStore.getState().categories).toContain('Demo only');
    expect(useStore.getState().user?.id).toBe(DEMO_USER.id);
  });
});
