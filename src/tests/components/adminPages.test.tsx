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
