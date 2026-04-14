import type { Station, StationRole, StationPermissions, OrderStatus } from './types';

const ALL_ACTIVE_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

export const ROLE_PRESETS: Record<StationRole, {
  label: string;
  description: string;
  color: string;
  permissions: StationPermissions;
}> = {
  kitchen: {
    label: 'Kitchen',
    description: 'Prep & cook workflow — timing, events, production summary',
    color: '#e8521a',
    permissions: {
      canAdvanceOrders: true,
      canCancelOrders: false,
      canLogKitchenEvents: true,
      canAdjustPrepTime: true,
      canReworkOrders: true,
      showProductionSummary: true,
      mapAccess: false,
      canUpdateTableStatus: false,
      canEditTableLayout: false,
      filterCategories: [],
      categoryMode: 'all',
      visibleStatuses: ALL_ACTIVE_STATUSES,
    },
  },
  service: {
    label: 'Service',
    description: 'Floor & delivery — map access, table management, order delivery',
    color: '#2563eb',
    permissions: {
      canAdvanceOrders: true,
      canCancelOrders: true,
      canLogKitchenEvents: false,
      canAdjustPrepTime: false,
      canReworkOrders: false,
      showProductionSummary: false,
      mapAccess: true,
      canUpdateTableStatus: true,
      canEditTableLayout: false,
      filterCategories: [],
      categoryMode: 'all',
      visibleStatuses: ALL_ACTIVE_STATUSES,
    },
  },
  bar: {
    label: 'Bar',
    description: 'Drink preparation — focus on bar categories, fast pour queue',
    color: '#7c3aed',
    permissions: {
      canAdvanceOrders: true,
      canCancelOrders: false,
      canLogKitchenEvents: false,
      canAdjustPrepTime: false,
      canReworkOrders: false,
      showProductionSummary: false,
      mapAccess: false,
      canUpdateTableStatus: false,
      canEditTableLayout: false,
      filterCategories: [],
      categoryMode: 'focus',
      visibleStatuses: ALL_ACTIVE_STATUSES,
    },
  },
  custom: {
    label: 'Custom',
    description: 'Fully configurable — set exactly what this station needs',
    color: '#64748b',
    permissions: {
      canAdvanceOrders: true,
      canCancelOrders: false,
      canLogKitchenEvents: false,
      canAdjustPrepTime: false,
      canReworkOrders: false,
      showProductionSummary: false,
      mapAccess: false,
      canUpdateTableStatus: false,
      canEditTableLayout: false,
      filterCategories: [],
      categoryMode: 'all',
      visibleStatuses: ALL_ACTIVE_STATUSES,
    },
  },
};

export const STATION_COLORS = [
  '#e8521a', '#2563eb', '#7c3aed', '#16a34a',
  '#ca8a04', '#0891b2', '#be123c', '#64748b',
];

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_KEY = (stationId: string) => `sl-station-${stationId}`;

export function isSessionValid(stationId: string): boolean {
  try {
    const raw = localStorage.getItem(SESSION_KEY(stationId));
    if (!raw) return false;
    const { expiresAt } = JSON.parse(raw) as { expiresAt: number };
    return expiresAt > Date.now();
  } catch {
    return false;
  }
}

export function openSession(stationId: string): void {
  localStorage.setItem(
    SESSION_KEY(stationId),
    JSON.stringify({ expiresAt: Date.now() + SESSION_TTL_MS }),
  );
}

export function closeSession(stationId: string): void {
  localStorage.removeItem(SESSION_KEY(stationId));
}

export function buildStation(overrides: Partial<Station> & { name: string; role: StationRole }): Station {
  const preset = ROLE_PRESETS[overrides.role];
  return {
    id: crypto.randomUUID(),
    color: preset.color,
    pin: '',
    permissions: { ...preset.permissions },
    createdAt: new Date().toISOString(),
    ...overrides,
  } as Station;
}

export function normalizeStation(station: Station): Station {
  const defaults = ROLE_PRESETS[station.role].permissions;
  const p = station.permissions;
  return {
    ...station,
    permissions: {
      canAdvanceOrders:      p.canAdvanceOrders      ?? defaults.canAdvanceOrders,
      canCancelOrders:       p.canCancelOrders        ?? defaults.canCancelOrders,
      canLogKitchenEvents:   p.canLogKitchenEvents    ?? defaults.canLogKitchenEvents,
      canAdjustPrepTime:     p.canAdjustPrepTime      ?? defaults.canAdjustPrepTime,
      canReworkOrders:       p.canReworkOrders        ?? defaults.canReworkOrders,
      showProductionSummary: p.showProductionSummary  ?? defaults.showProductionSummary,
      mapAccess:             p.mapAccess              ?? defaults.mapAccess,
      canUpdateTableStatus:  p.canUpdateTableStatus   ?? defaults.canUpdateTableStatus,
      canEditTableLayout:    p.canEditTableLayout     ?? defaults.canEditTableLayout,
      filterCategories:      p.filterCategories       ?? defaults.filterCategories,
      categoryMode:          p.categoryMode           ?? defaults.categoryMode,
      visibleStatuses:       (p.visibleStatuses?.length ?? 0) > 0
                               ? p.visibleStatuses
                               : defaults.visibleStatuses,
    },
  };
}
