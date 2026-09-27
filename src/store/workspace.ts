import type {
  User, MenuItem, Table, Order, Receipt, BusinessSettings, Station, StockReservation,
  Ingredient, KitchenEvent, MapDecoration, CalendarEvent, EventPackage, CalendarSettings,
  Employee, Shift,
} from '@/domain/types';
import { DEFAULT_SETTINGS, DEMO_USER, SEED_MENU_ITEMS, SEED_TABLES, FRESH_TABLES, SEED_CATEGORIES, SEED_INGREDIENTS } from '@/domain/initialData';

export const AUTH_KEY = 'smartline-auth';
export const WORKSPACE_KEY = (userId: string) => `smartline-workspace-${userId}`;

import { DEFAULT_CALENDAR_SETTINGS } from '@/domain/booking/policy';
export { DEFAULT_CALENDAR_SETTINGS };

/** The complete persisted tenant state. Auth and actions are never deserialized. */
export interface WorkspaceSnapshot {
  menuItems: MenuItem[];
  categories: string[];
  tables: Table[];
  orders: Order[];
  receipts: Receipt[];
  settings: BusinessSettings;
  stations: Station[];
  nextOrderNumber: number;
  reservations: StockReservation[];
  ingredients: Ingredient[];
  kitchenEvents: KitchenEvent[];
  decorations: MapDecoration[];
  calendarEvents: CalendarEvent[];
  eventPackages: EventPackage[];
  calendarSettings: CalendarSettings;
  employees: Employee[];
  shifts: Shift[];
}

export function emptyWorkspace(): WorkspaceSnapshot {
  return {
    menuItems: [], categories: [], tables: [], orders: [], receipts: [],
    settings: { ...structuredClone(DEFAULT_SETTINGS), stations: [] }, stations: [], nextOrderNumber: 1001,
    reservations: [], ingredients: [], kitchenEvents: [], decorations: [],
    calendarEvents: [], eventPackages: [], calendarSettings: structuredClone(DEFAULT_CALENDAR_SETTINGS),
    employees: [], shifts: [],
  };
}

export const WORKSPACE_KEYS = Object.keys(emptyWorkspace()) as (keyof WorkspaceSnapshot)[];

export function defaultWorkspace(user: User): WorkspaceSnapshot {
  const isDemo = user.id === DEMO_USER.id;
  return {
    ...emptyWorkspace(),
    menuItems: structuredClone(isDemo ? SEED_MENU_ITEMS : []),
    categories: [...SEED_CATEGORIES],
    tables: structuredClone(isDemo ? SEED_TABLES : FRESH_TABLES),
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      businessName: isDemo ? DEFAULT_SETTINGS.businessName : user.businessName,
      restaurantToken: isDemo ? DEFAULT_SETTINGS.restaurantToken : crypto.randomUUID(),
      stations: [],
    },
    ingredients: structuredClone(isDemo ? SEED_INGREDIENTS : []),
  };
}

/** Select by the canonical schema so new slices cannot be omitted by a writer. */
export function workspaceSnapshot(state: WorkspaceSnapshot): WorkspaceSnapshot {
  const snapshot = Object.fromEntries(WORKSPACE_KEYS.map(key => [key, state[key]])) as unknown as WorkspaceSnapshot;
  return { ...snapshot, settings: { ...snapshot.settings, stations: snapshot.stations } };
}

/** Legacy snapshots stored stations under settings; every hydration enforces both views. */
export function normalizeWorkspace(state: WorkspaceSnapshot): WorkspaceSnapshot {
  const stations = state.settings.stations ?? state.stations ?? [];
  return {
    ...workspaceSnapshot(state), stations,
    settings: { ...state.settings, stations },
    calendarSettings: { ...structuredClone(DEFAULT_CALENDAR_SETTINGS), ...state.calendarSettings },
  };
}

export function loadWorkspaceStateLocal(userId: string, user: User): WorkspaceSnapshot {
  const defaults = defaultWorkspace(user);
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY(userId));
    const saved: { state?: Partial<WorkspaceSnapshot> } = raw ? JSON.parse(raw) : {};
    if (!saved.state || typeof saved.state !== 'object') return defaults;
    const state = saved.state;
    // Only copy persisted data keys, never arbitrary properties or store actions.
    const selected = Object.fromEntries(WORKSPACE_KEYS.map(key => [key, state[key] ?? defaults[key]])) as unknown as WorkspaceSnapshot;
    for (const key of WORKSPACE_KEYS) {
      if (Array.isArray(defaults[key]) && !Array.isArray(selected[key])) {
        Object.assign(selected, { [key]: defaults[key] });
      }
    }
    const timestamp = Date.now();
    const cutoff = timestamp - 90 * 24 * 60 * 60 * 1000;
    return normalizeWorkspace({
      ...selected,
      settings: {
        ...defaults.settings, ...state.settings,
        restaurantToken: state.settings?.restaurantToken || defaults.settings.restaurantToken,
        stations: state.settings?.stations ?? state.stations ?? [],
      },
      orders: selected.orders.filter(order => new Date(order.createdAt).getTime() > cutoff),
      receipts: selected.receipts.filter(receipt => new Date(receipt.createdAt).getTime() > cutoff),
      kitchenEvents: selected.kitchenEvents.filter(event => new Date(event.createdAt).getTime() > cutoff),
      reservations: selected.reservations.filter(reservation => reservation.expiresAt > timestamp),
    });
  } catch {
    return defaults;
  }
}

export function saveWorkspaceStateLocal(userId: string, state: WorkspaceSnapshot): void {
  localStorage.setItem(WORKSPACE_KEY(userId), JSON.stringify({ state: workspaceSnapshot(state), version: 1 }));
}
