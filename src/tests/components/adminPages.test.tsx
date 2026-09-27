/**
 * Render smoke test for every admin page in local/demo mode: catches import
 * cycles, missing providers and crashes after refactors (e.g. the module splits).
 */
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ComponentType } from 'react';
import { useStore } from '@/store';

const pages: Array<[string, () => Promise<{ default: ComponentType }>]> = [
  ['Dashboard', () => import('@/pages/admin/Dashboard')],
  ['Orders', () => import('@/pages/admin/Orders')],
  ['MenuManager', () => import('@/pages/admin/MenuManager')],
  ['Inventory', () => import('@/pages/admin/Inventory')],
  ['Tables', () => import('@/pages/admin/Tables')],
  ['PrepTimes', () => import('@/pages/admin/PrepTimes')],
  ['Analytics', () => import('@/pages/admin/Analytics')],
  ['Ingredients', () => import('@/pages/admin/Ingredients')],
  ['Settings', () => import('@/pages/admin/Settings')],
  ['Stations', () => import('@/pages/admin/Stations')],
  ['Calendar', () => import('@/pages/admin/Calendar')],
];

beforeAll(async () => {
  // ResizeObserver is used by charts; jsdom does not provide it.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  await useStore.getState().login('demo@smartline.io', 'demo1234');
});
afterEach(cleanup);

describe('admin pages render (demo workspace)', { timeout: 30_000 }, () => {
  it.each(pages)('%s', async (_name, load) => {
    const { default: Page } = await load();
    render(<MemoryRouter><Page /></MemoryRouter>);
    expect(await screen.findAllByRole('link', { name: /settings/i })).not.toHaveLength(0);
  });
});

describe('revenue consumers use payment state, not kitchen state', { timeout: 30_000 }, () => {
  it('Dashboard: unpaid orders count as volume and outstanding, never as revenue; Orders: Mark paid records payment', async () => {
    const createdAt = new Date().toISOString();
    const base = { tableId: 'takeaway', tableName: 'Takeaway', items: [], subtotal: 0, taxRate: 0, taxAmount: 0, paymentMethod: 'cash' as const, notes: '', estimatedPrepTime: 10, prepTimeAdjustment: 0, createdAt, updatedAt: createdAt };
    useStore.setState({ orders: [
      { ...base, id: 'o-paid', orderNumber: 901, status: 'completed', total: 40, paymentStatus: 'paid', paidAt: createdAt },
      { ...base, id: 'o-unpaid', orderNumber: 902, status: 'ready', total: 25, paymentStatus: 'unpaid' },
      { ...base, id: 'o-cancel', orderNumber: 903, status: 'cancelled', total: 99, paymentStatus: 'paid', paidAt: createdAt },
    ] });
    const { default: Dashboard } = await import('@/pages/admin/Dashboard');
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const sym = useStore.getState().settings.currencySymbol;
    expect(await screen.findByText(`${sym}40`)).toBeTruthy();
    expect(screen.getByText(`${sym}25 unpaid`)).toBeTruthy();
    cleanup();

    const { default: Orders } = await import('@/pages/admin/Orders');
    render(<MemoryRouter><Orders /></MemoryRouter>);
    const buttons = await screen.findAllByRole('button', { name: 'Mark paid' });
    expect(buttons).toHaveLength(1);
    buttons[0].click();
    await vi.waitFor(() => expect(useStore.getState().orders.find(o => o.id === 'o-unpaid')?.paymentStatus).toBe('paid'));
    expect(useStore.getState().orders.find(o => o.id === 'o-unpaid')?.status).toBe('ready');
  });
});
