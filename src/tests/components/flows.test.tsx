import { render, screen, fireEvent, cleanup, waitFor, renderHook, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Menu from '@/pages/customer/Menu';
import Receipt from '@/pages/customer/Receipt';
import BookingPage, { StatusBadge } from '@/pages/customer/BookingPage';
import { useStore } from '@/store';
import { useStationOrders } from '@/lib/supabase/realtime/useStationOrders';
import { buildStation } from '@/domain/stations';
import { DEFAULT_SETTINGS, SEED_MENU_ITEMS, SEED_TABLES } from '@/domain/initialData';
import { DEFAULT_CALENDAR_SETTINGS } from '@/domain/booking/policy';
import type { Order } from '@/domain/types';

const allDays = ([0, 1, 2, 3, 4, 5, 6] as const).map(dayOfWeek => ({ dayOfWeek, isOpen: true, openTime: '00:00', closeTime: '00:00' }));
const soup = { ...SEED_MENU_ITEMS[0], id: 'soup', name: 'Tomato Soup', price: 6, stock: 3, modifiers: [], status: 'active' as const };

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/menu" element={<Menu />} />
        <Route path="/receipt/:receiptId" element={<Receipt />} />
        <Route path="/book/:restaurantToken" element={<BookingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-28T10:00:00Z'));   // Monday, 12:00 in Podgorica
  localStorage.clear(); sessionStorage.clear();
  useStore.setState({
    _hasHydrated: true, user: null,
    settings: { ...DEFAULT_SETTINGS, restaurantToken: 'test', timezone: 'Europe/Podgorica', businessHours: allDays, takeawayEnabled: true, deliveryEnabled: true },
    menuItems: [soup], tables: SEED_TABLES, orders: [], receipts: [], reservations: [],
    calendarSettings: { ...DEFAULT_CALENDAR_SETTINGS, requireApproval: true }, calendarEvents: [], eventPackages: [],
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('dine-in QR happy path (local mode)', () => {
  it('adds an item, places the order and lands on the receipt with Order More back to the table', async () => {
    const table = SEED_TABLES[0];
    renderAt(`/menu?t=${table.id}&r=test`);
    fireEvent.click(screen.getByText('Tomato Soup'));
    const add = await screen.findAllByRole('button', { name: /add/i });
    fireEvent.click(add[add.length - 1]);
    fireEvent.click(await screen.findByRole('button', { name: /view order|cart|checkout/i }));
    fireEvent.click(await screen.findByRole('button', { name: /proceed|continue|payment/i }));
    fireEvent.click(await screen.findByRole('button', { name: /place order/i }));

    await screen.findByText(/order more/i);
    const order = useStore.getState().orders[0];
    expect(order).toMatchObject({ tableId: table.id, orderChannel: 'dine-in', paymentStatus: 'unpaid', status: 'paid', total: 6 });
    expect(useStore.getState().menuItems[0].stock).toBe(2);
    expect(useStore.getState().tables.find(t => t.id === table.id)?.status).toBe('occupied');
    expect(screen.getByRole('link', { name: /order more/i }).getAttribute('href')).toBe(`/menu?t=${encodeURIComponent(table.id)}&r=test`);
  });
});

describe('Receipt', () => {
  it('Order More for takeaway keeps mode/date/time and never puts the address in the URL', () => {
    const createdAt = new Date().toISOString();
    const order = { id: 'o1', orderNumber: 1001, tableId: 'delivery', tableName: 'Delivery', items: [], status: 'paid', subtotal: 6, taxRate: 10, taxAmount: 0, total: 6, paymentMethod: 'cash', paymentStatus: 'unpaid', notes: '', estimatedPrepTime: 10, prepTimeAdjustment: 0, createdAt, paidAt: createdAt, updatedAt: createdAt } as Order;
    useStore.setState({
      orders: [order],
      receipts: [{ id: 'r1', orderId: 'o1', orderNumber: 1001, tableId: 'delivery', tableName: 'Delivery', restaurantName: 'Test', items: [], subtotal: 6, taxRate: 10, taxAmount: 0, total: 6, paymentMethod: 'cash', paymentStatus: 'unpaid', createdAt }],
    });
    sessionStorage.setItem('smartline-delivery-test', JSON.stringify({ address: 'Secret street 9', expiresAt: Date.now() + 60_000 }));
    renderAt('/receipt/r1?r=test&mode=delivery&date=2026-09-28&time=18:00');
    const href = screen.getByRole('link', { name: /order more/i }).getAttribute('href') ?? '';
    expect(href).toContain('mode=delivery');
    expect(href).toContain('date=2026-09-28');
    expect(href).not.toContain('Secret');
    expect(href).not.toContain('addr');
  });
});

describe('Booking (local mode)', () => {
  it('shows a confirmation code and finds the booking only with phone + code', async () => {
    renderAt('/book/test');
    // 2026-09-30 is a Wednesday, open 09-22 by default.
    const day = await screen.findByRole('button', { name: '30' });
    fireEvent.click(day);
    fireEvent.click(await screen.findByRole('button', { name: '19:00' }));
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: '+382 67 123 456' } });
    fireEvent.click(screen.getByRole('button', { name: /send event request/i }));

    const code = (await screen.findByTestId('confirmation-code')).textContent ?? '';
    expect(code).toMatch(/^[0-9A-F]{8}$/);
    const saved = useStore.getState().calendarEvents[0];
    expect(saved).toMatchObject({ status: 'pending', type: 'reservation', createdBy: 'customer', confirmationCode: code });

    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('⏳ Pending')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Confirmation code'), { target: { value: '00000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/No booking found/)).toBeInTheDocument();
  });

  it('renders every status with its own label (rejected is not shown as pending)', () => {
    render(<>{(['approved', 'pending', 'rejected', 'cancelled', 'completed'] as const).map(s => <StatusBadge key={s} status={s} />)}</>);
    expect(screen.getByText('✗ Declined')).toBeInTheDocument();
    expect(screen.getAllByText('⏳ Pending')).toHaveLength(1);
  });
});

describe('station actions (local mode) match server semantics', () => {
  it('rework sends a ready order back to preparing and logs a remake; cancel restores stock once', async () => {
    const station = buildStation({ name: 'Kitchen', role: 'kitchen' });
    const createdAt = new Date().toISOString();
    const base = { orderNumber: 1, tableId: SEED_TABLES[0].id, tableName: 'Table 1', items: [{ menuItemId: 'soup', menuItemName: 'Tomato Soup', menuItemIcon: '', quantity: 2, unitPrice: 6, modifiers: [], lineTotal: 12 }], subtotal: 12, taxRate: 0, taxAmount: 0, total: 12, paymentMethod: 'cash' as const, notes: '', estimatedPrepTime: 10, prepTimeAdjustment: 0, createdAt, paidAt: createdAt, updatedAt: createdAt };
    useStore.setState({ orders: [{ ...base, id: 'ready1', status: 'ready' }, { ...base, id: 'paid1', status: 'paid' }], menuItems: [{ ...soup, stock: 1 }] });
    const { result } = renderHook(() => useStationOrders(station));

    await act(async () => { expect(await result.current.remakeOrder('ready1', 'Cold')).toBe(true); });
    expect(useStore.getState().orders.find(o => o.id === 'ready1')?.status).toBe('preparing');
    expect(useStore.getState().kitchenEvents[0]).toMatchObject({ type: 'remake', orderId: 'ready1', stationId: station.id });

    // Kitchen preset has no canCancelOrders: rejected locally exactly like the server.
    await act(async () => { expect(await result.current.advanceOrder('paid1', 'cancelled')).toBe(false); });
    expect(useStore.getState().orders.find(o => o.id === 'paid1')?.status).toBe('paid');
    await act(async () => { await useStore.getState().cancelOrder('paid1'); });
    await act(async () => { await useStore.getState().cancelOrder('paid1'); });
    await waitFor(() => expect(useStore.getState().menuItems[0].stock).toBe(3));
  });
});
