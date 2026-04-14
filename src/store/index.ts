import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  User, MenuItem, MenuItemStatus, Table, TableStatus,
  Order, OrderStatus, OrderItem, OrderItemModifier,
  Receipt, CartItem, StockReservation, BusinessSettings,
  CheckoutPayload, CheckoutResult, CartValidationResult, CartValidationIssue,
  PaymentMethod, Ingredient, KitchenEvent, Station, MapDecoration, DecorationType,
} from '../domain/types';
import {
  SEED_MENU_ITEMS, SEED_TABLES, DEFAULT_SETTINGS, DEMO_USER, SEED_CATEGORIES,
  FRESH_MENU_ITEMS, FRESH_TABLES, SEED_INGREDIENTS,
} from '../domain/initialData';
import { advance, isActiveOrder, isRevenueOrder } from '../domain/orderMachine';
import { normalizeStation } from '../domain/stations';
import { isSupabaseEnabled } from './flags';
import * as bridge from './bridge';

// ─── Utility ──────────────────────────────────────────────────────────────────

const genId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const RESERVATION_TTL_MS = 5 * 60 * 1000;

// ─── Workspace defaults ───────────────────────────────────────────────────────

type WorkspaceSnapshot = {
  menuItems: MenuItem[];
  categories: string[];
  tables: Table[];
  orders: Order[];
  receipts: Receipt[];
  settings: BusinessSettings;
  nextOrderNumber: number;
  reservations: StockReservation[];
  ingredients: Ingredient[];
  kitchenEvents: KitchenEvent[];
  decorations: MapDecoration[];
};

function defaultWorkspace(user: User): WorkspaceSnapshot {
  const isDemo = user.id === DEMO_USER.id;
  return {
    menuItems:      isDemo ? SEED_MENU_ITEMS : FRESH_MENU_ITEMS,
    categories:     SEED_CATEGORIES,
    tables:         isDemo ? SEED_TABLES : FRESH_TABLES,
    orders:         [],
    receipts:       [],
    settings: {
      ...DEFAULT_SETTINGS,
      businessName:    isDemo ? DEFAULT_SETTINGS.businessName : user.businessName,
      restaurantToken: isDemo ? DEFAULT_SETTINGS.restaurantToken : genId(),
    },
    nextOrderNumber: 1001,
    reservations:   [],
    ingredients:    isDemo ? SEED_INGREDIENTS : [],
    kitchenEvents:  [],
    decorations:    [],
  };
}

// Legacy localStorage helpers — used only when Supabase is NOT enabled.
const AUTH_KEY = 'smartline-auth';
const WORKSPACE_KEY = (userId: string) => `smartline-workspace-${userId}`;
let _activeUserId: string | null = null;

if (typeof window !== 'undefined' && !isSupabaseEnabled()) {
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) _activeUserId = JSON.parse(saved)?.user?.id ?? null;
  } catch { /* ignore */ }
}

function loadWorkspaceStateLocal(userId: string, user: User): WorkspaceSnapshot {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state) {
        const defaults = defaultWorkspace(user);
        return {
          ...defaults,
          ...parsed.state,
          settings: {
            ...defaults.settings,
            ...parsed.state.settings,
            restaurantToken: parsed.state.settings?.restaurantToken || defaults.settings.restaurantToken,
          },
          reservations: (parsed.state.reservations ?? []).filter(
            (r: StockReservation) => r.expiresAt > Date.now(),
          ),
          ingredients:   parsed.state.ingredients   ?? defaults.ingredients,
          kitchenEvents: parsed.state.kitchenEvents ?? [],
          decorations:   parsed.state.decorations   ?? [],
        };
      }
    }
  } catch { /* fall through */ }
  return defaultWorkspace(user);
}

function saveWorkspaceStateLocal(userId: string, state: WorkspaceSnapshot) {
  try {
    localStorage.setItem(WORKSPACE_KEY(userId), JSON.stringify({ state, version: 1 }));
  } catch { /* ignore quota errors */ }
}

// ─── State Shape ──────────────────────────────────────────────────────────────

export interface AppState {
  _hasHydrated: boolean;

  user: User | null;
  isAuthenticated: boolean;

  menuItems: MenuItem[];
  categories: string[];
  tables: Table[];
  orders: Order[];
  receipts: Receipt[];
  settings: BusinessSettings;
  nextOrderNumber: number;
  reservations: StockReservation[];
  ingredients: Ingredient[];
  kitchenEvents: KitchenEvent[];
  decorations: MapDecoration[];

  login:  (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  signup: (data: { email: string; password: string; name: string; businessName: string }) => Promise<{ success: boolean; error?: string }>;

  addMenuItem:       (data: Omit<MenuItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'salesCount'>) => MenuItem;
  updateMenuItem:    (id: string, updates: Partial<Omit<MenuItem, 'id' | 'createdAt'>>) => void;
  deleteMenuItem:    (id: string) => void;
  setMenuItemStatus: (id: string, status: MenuItemStatus) => void;
  reorderMenuItems:  (orderedIds: string[]) => void;
  addCategory:       (name: string) => void;
  deleteCategory:    (name: string) => void;

  addTable:       (data: { number: number; name: string; capacity: number; shape?: Table['shape']; zone?: string; floor?: string; rotation?: number; sizeScale?: number; x?: number; y?: number }) => Table;
  updateTable:    (id: string, updates: { name?: string; number?: number; capacity?: number; shape?: Table['shape']; zone?: string; floor?: string; rotation?: number; sizeScale?: number; x?: number | null; y?: number | null; status?: TableStatus }) => void;

  addDecoration:    (data: { type: DecorationType; x: number; y: number; w: number; h: number; floor?: string; rotation?: number }) => MapDecoration;
  updateDecoration: (id: string, updates: Partial<Pick<MapDecoration, 'x' | 'y' | 'w' | 'h' | 'floor' | 'rotation'>>) => void;
  deleteDecoration: (id: string) => void;
  deleteTable:    (id: string) => void;
  setTableStatus: (id: string, status: TableStatus) => void;

  adjustStock:  (itemId: string, delta: number) => void;
  setStock:     (itemId: string, stock: number) => void;
  restockItem:  (itemId: string) => void;

  advanceOrderStatus: (orderId: string) => void;
  cancelOrder:        (orderId: string) => void;
  refundOrder:        (orderId: string) => void;
  adjustPrepTime:     (orderId: string, deltaMinutes: number) => void;

  updateSettings: (updates: Partial<BusinessSettings>) => void;

  addIngredient:    (data: Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>) => Ingredient;
  updateIngredient: (id: string, updates: Partial<Omit<Ingredient, 'id' | 'createdAt'>>) => void;
  deleteIngredient: (id: string) => void;
  logKitchenEvent:  (data: Omit<KitchenEvent, 'id' | 'createdAt'>) => void;

  addStation:    (data: Station) => void;
  updateStation: (id: string, updates: Partial<Station>) => void;
  deleteStation: (id: string) => void;

  validateCart:       (cart: CartItem[]) => CartValidationResult;
  createReservation:  (sessionId: string, cart: CartItem[]) => boolean;
  releaseReservation: (sessionId: string) => void;
  checkout:           (payload: CheckoutPayload) => Promise<CheckoutResult>;

  getAvailableStock: (itemId: string) => number;
  getActiveOrders:   () => Order[];
  getTodayOrders:    () => Order[];
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<AppState>()((set, get) => ({
  _hasHydrated:    false,
  user:            null,
  isAuthenticated: false,
  menuItems:       [],
  categories:      [],
  tables:          [],
  orders:          [],
  receipts:        [],
  settings:        DEFAULT_SETTINGS,
  nextOrderNumber: 1001,
  reservations:    [],
  ingredients:     [],
  kitchenEvents:   [],
  decorations:     [],

  // ── Auth ────────────────────────────────────────────────────────────────────

  async login(email, password) {
    // Demo account always uses local path regardless of Supabase
    if (email === 'demo@smartline.io' && password === 'demo1234') {
      _activeUserId = DEMO_USER.id;
      localStorage.setItem(AUTH_KEY, JSON.stringify({ user: DEMO_USER, isAuthenticated: true }));
      const workspace = loadWorkspaceStateLocal(DEMO_USER.id, DEMO_USER);
      set({ user: DEMO_USER, isAuthenticated: true, _hasHydrated: true, ...workspace });
      return { success: true };
    }

    if (isSupabaseEnabled()) {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) return { success: false, error: 'Supabase not configured.' };

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data.user) {
        return { success: false, error: 'Invalid email or password.' };
      }

      const sbUser = data.user;
      const meta = sbUser.user_metadata as Record<string, string> | undefined;
      const user: User = {
        id:           sbUser.id,
        email:        sbUser.email ?? email,
        name:         meta?.name ?? email.split('@')[0],
        businessName: meta?.businessName ?? 'My Restaurant',
        role:         'admin',
        createdAt:    sbUser.created_at,
      };

      const { loadWorkspaceFromSupabase } = await import('./hydration');
      const workspace = await loadWorkspaceFromSupabase(user.id, user);
      set({ user, isAuthenticated: true, _hasHydrated: true, ...workspace });
      return { success: true };
    }

    // ── Local fallback (no Supabase) ──────────────────────────────────────────
    let foundUser: User | null = null;
    if (email === 'demo@smartline.io' && password === 'demo1234') {
      foundUser = DEMO_USER;
    } else {
      const accounts: { email: string; password: string; user: User }[] = JSON.parse(
        localStorage.getItem('smartline-accounts') || '[]',
      );
      foundUser = accounts.find(a => a.email === email && a.password === password)?.user ?? null;
    }
    if (!foundUser) return { success: false, error: 'Invalid email or password.' };

    _activeUserId = foundUser.id;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user: foundUser, isAuthenticated: true }));
    const workspace = loadWorkspaceStateLocal(foundUser.id, foundUser);
    set({ user: foundUser, isAuthenticated: true, _hasHydrated: true, ...workspace });
    return { success: true };
  },

  async logout() {
    if (isSupabaseEnabled()) {
      const { supabase } = await import('@/lib/supabase/client');
      await supabase?.auth.signOut();
    } else {
      _activeUserId = null;
      localStorage.removeItem(AUTH_KEY);
    }
    set({
      user: null, isAuthenticated: false,
      menuItems: [], categories: [], tables: [], orders: [], receipts: [],
      settings: DEFAULT_SETTINGS, nextOrderNumber: 1001, reservations: [],
      ingredients: [], kitchenEvents: [], decorations: [],
    });
  },

  async signup({ email, password, name, businessName }) {
    if (isSupabaseEnabled()) {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) return { success: false, error: 'Supabase not configured.' };

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, businessName } },
      });
      if (error || !data.user) {
        return { success: false, error: error?.message ?? 'Signup failed.' };
      }

      const sbUser = data.user;
      const user: User = {
        id:           sbUser.id,
        email:        sbUser.email ?? email,
        name,
        businessName,
        role:         'admin',
        createdAt:    sbUser.created_at,
      };

      // Seed the new workspace in Supabase
      const workspace = defaultWorkspace(user);
      const { upsertSettings } = await import('@/lib/supabase/queries/settings');
      const { insertMenuItem } = await import('@/lib/supabase/queries/menu');
      const { insertTable }    = await import('@/lib/supabase/queries/tables');

      await upsertSettings(workspace.settings, user.id, workspace.nextOrderNumber);
      await Promise.all(workspace.menuItems.map(item => insertMenuItem(item, user.id)));
      await Promise.all(workspace.tables.map(table => insertTable(table, user.id)));

      set({ user, isAuthenticated: true, _hasHydrated: true, ...workspace });
      return { success: true };
    }

    // ── Local fallback ────────────────────────────────────────────────────────
    const accounts: { email: string; password: string; user: User }[] = JSON.parse(
      localStorage.getItem('smartline-accounts') || '[]',
    );
    if (accounts.some(a => a.email === email) || email === 'demo@smartline.io') {
      return { success: false, error: 'An account with this email already exists.' };
    }
    const newUser: User = {
      id: genId(), email, name, businessName, role: 'admin', createdAt: now(),
    };
    accounts.push({ email, password, user: newUser });
    localStorage.setItem('smartline-accounts', JSON.stringify(accounts));
    _activeUserId = newUser.id;
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user: newUser, isAuthenticated: true }));
    const workspace = defaultWorkspace(newUser);
    set({ user: newUser, isAuthenticated: true, _hasHydrated: true, ...workspace });
    return { success: true };
  },

  // ── Menu ────────────────────────────────────────────────────────────────────

  addMenuItem(data) {
    const { menuItems, user } = get();
    const item: MenuItem = {
      ...data,
      id:         genId(),
      sortOrder:  menuItems.length + 1,
      salesCount: 0,
      createdAt:  now(),
      updatedAt:  now(),
    };
    set(s => ({ menuItems: [...s.menuItems, item] }));
    _persistLocal(get);
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistNewMenuItem(item, user.id).catch((err: unknown) =>
        toast.error(`Failed to save menu item: ${err instanceof Error ? err.message : String(err)}`));
    }
    return item;
  },

  updateMenuItem(id, updates) {
    const prev = get().menuItems.find(m => m.id === id);
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === id ? { ...i, ...updates, updatedAt: now() } : i),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistMenuItemUpdate(id, updates).catch(() => {
        if (prev) set(s => ({ menuItems: s.menuItems.map(i => i.id === id ? prev : i) }));
        toast.error('Failed to update menu item.');
      });
    }
  },

  deleteMenuItem(id) {
    const prev = get().menuItems.find(m => m.id === id);
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === id ? { ...i, status: 'archived' as MenuItemStatus, updatedAt: now() } : i),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistMenuItemUpdate(id, { status: 'archived' }).catch(() => {
        if (prev) set(s => ({ menuItems: s.menuItems.map(i => i.id === id ? prev : i) }));
        toast.error('Failed to archive menu item.');
      });
    }
  },

  setMenuItemStatus(id, status) {
    const prev = get().menuItems.find(m => m.id === id);
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === id ? { ...i, status, updatedAt: now() } : i),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistMenuItemUpdate(id, { status }).catch(() => {
        if (prev) set(s => ({ menuItems: s.menuItems.map(i => i.id === id ? prev : i) }));
        toast.error('Failed to update item status.');
      });
    }
  },

  reorderMenuItems(orderedIds) {
    set(s => ({
      menuItems: s.menuItems.map(i => {
        const idx = orderedIds.indexOf(i.id);
        return idx >= 0 ? { ...i, sortOrder: idx + 1 } : i;
      }),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled()) {
      bridge.persistMenuItemReorder(orderedIds.map((id, i) => ({ id, sortOrder: i + 1 })))
        .catch(() => toast.error('Failed to save order to server.'));
    }
  },

  addCategory(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    set(s => {
      if (s.categories.includes(trimmed)) return s;
      return { categories: [...s.categories, trimmed] };
    });
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      const { settings, user } = get();
      bridge.persistSettings(settings, user!.id).catch(() =>
        toast.error('Failed to save category.'));
    }
  },

  deleteCategory(name) {
    set(s => ({ categories: s.categories.filter(c => c !== name) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      const { settings, user } = get();
      bridge.persistSettings(settings, user!.id).catch(() =>
        toast.error('Failed to delete category.'));
    }
  },

  // ── Tables ──────────────────────────────────────────────────────────────────

  addTable(data) {
    const table: Table = {
      id: genId(), number: data.number, name: data.name,
      capacity: data.capacity, status: 'available',
      shape:     data.shape ?? 'square',
      zone:      data.zone,
      floor:     data.floor,
      rotation:  data.rotation  ?? 0,
      sizeScale: data.sizeScale ?? 1,
      x: data.x ?? null,
      y: data.y ?? null,
      createdAt: now(),
    };
    set(s => ({ tables: [...s.tables, table] }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistNewTable(table, get().user!.id).catch((err: unknown) =>
        toast.error(`Failed to save table: ${err instanceof Error ? err.message : String(err)}`));
    }
    return table;
  },

  updateTable(id, updates) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.map(t => t.id === id ? { ...t, ...updates } : t) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistTableUpdate(id, updates).catch(() => {
        if (prev) set(s => ({ tables: s.tables.map(t => t.id === id ? prev : t) }));
        toast.error('Failed to update table.');
      });
    }
  },

  deleteTable(id) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.filter(t => t.id !== id) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistDeleteTable(id).catch(() => {
        if (prev) set(s => ({ tables: [...s.tables, prev] }));
        toast.error('Failed to delete table.');
      });
    }
  },

  addDecoration(data) {
    const dec: MapDecoration = {
      id: genId(), type: data.type,
      x: data.x, y: data.y, w: data.w, h: data.h,
      floor: data.floor, rotation: data.rotation ?? 0,
    };
    set(s => ({ decorations: [...s.decorations, dec] }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistNewDecoration(dec, get().user!.id).catch((err: unknown) =>
        toast.error(`Failed to save decoration: ${err instanceof Error ? err.message : String(err)}`));
    }
    return dec;
  },

  updateDecoration(id, updates) {
    set(s => ({ decorations: s.decorations.map(d => d.id === id ? { ...d, ...updates } : d) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistDecorationUpdate(id, updates).catch(() =>
        toast.error('Failed to update decoration.'));
    }
  },

  deleteDecoration(id) {
    const prev = get().decorations.find(d => d.id === id);
    set(s => ({ decorations: s.decorations.filter(d => d.id !== id) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistDeleteDecoration(id).catch(() => {
        if (prev) set(s => ({ decorations: [...s.decorations, prev] }));
        toast.error('Failed to delete decoration.');
      });
    }
  },

  setTableStatus(id, status) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.map(t => t.id === id ? { ...t, status } : t) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistTableUpdate(id, { status }).catch(() => {
        if (prev) set(s => ({ tables: s.tables.map(t => t.id === id ? prev : t) }));
        toast.error('Failed to update table status.');
      });
    }
  },

  // ── Stock ────────────────────────────────────────────────────────────────────

  adjustStock(itemId, delta) {
    set(s => ({
      menuItems: s.menuItems.map(i => {
        if (i.id !== itemId || i.stock === null) return i;
        return { ...i, stock: Math.max(0, i.stock + delta), updatedAt: now() };
      }),
    }));
    _persistLocal(get);
    const item = get().menuItems.find(m => m.id === itemId);
    if (isSupabaseEnabled() && get().user?.id && item?.stock !== null) {
      bridge.persistMenuItemUpdate(itemId, { stock: item?.stock }).catch(() =>
        toast.error('Failed to sync stock.'));
    }
  },

  setStock(itemId, stock) {
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === itemId ? { ...i, stock: Math.max(0, stock), updatedAt: now() } : i),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistMenuItemUpdate(itemId, { stock: Math.max(0, stock) }).catch(() =>
        toast.error('Failed to sync stock.'));
    }
  },

  restockItem(itemId) {
    set(s => ({
      menuItems: s.menuItems.map(i =>
        i.id === itemId && i.maxStock !== null
          ? { ...i, stock: i.maxStock, updatedAt: now() } : i),
    }));
    _persistLocal(get);
    const item = get().menuItems.find(m => m.id === itemId);
    if (isSupabaseEnabled() && get().user?.id && item?.maxStock !== null) {
      bridge.persistMenuItemUpdate(itemId, { stock: item?.maxStock }).catch(() =>
        toast.error('Failed to sync stock.'));
    }
  },

  // ── Orders ───────────────────────────────────────────────────────────────────

  advanceOrderStatus(orderId) {
    const prev = get().orders.find(o => o.id === orderId);
    set(s => ({
      orders: s.orders.map(o => {
        if (o.id !== orderId) return o;
        const next = advance(o.status);
        if (!next) return o;
        return { ...o, status: next, updatedAt: now() };
      }),
    }));
    _persistLocal(get);
    const updated = get().orders.find(o => o.id === orderId);
    if (isSupabaseEnabled() && get().user?.id && updated) {
      bridge.persistOrderUpdate(orderId, { status: updated.status }).catch(() => {
        if (prev) set(s => ({ orders: s.orders.map(o => o.id === orderId ? prev : o) }));
        toast.error('Failed to update order status.');
      });
    }
  },

  cancelOrder(orderId) {
    const order = get().orders.find(o => o.id === orderId);
    if (!order) return;
    _restoreStock(get, set, order);
    set(s => ({
      orders: s.orders.map(o =>
        o.id === orderId ? { ...o, status: 'cancelled' as OrderStatus, updatedAt: now() } : o),
    }));
    const table = get().tables.find(t => t.id === order.tableId);
    if (table?.status === 'occupied') get().setTableStatus(order.tableId, 'available');
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistOrderUpdate(orderId, { status: 'cancelled' }).catch(() =>
        toast.error('Failed to cancel order on server.'));
    }
  },

  refundOrder(orderId) {
    const prev = get().orders.find(o => o.id === orderId);
    set(s => ({
      orders: s.orders.map(o =>
        o.id === orderId && o.status === 'cancelled'
          ? { ...o, status: 'refunded' as OrderStatus, updatedAt: now() } : o),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistOrderUpdate(orderId, { status: 'refunded' }).catch(() => {
        if (prev) set(s => ({ orders: s.orders.map(o => o.id === orderId ? prev : o) }));
        toast.error('Failed to mark order as refunded.');
      });
    }
  },

  adjustPrepTime(orderId, deltaMinutes) {
    set(s => ({
      orders: s.orders.map(o =>
        o.id === orderId
          ? { ...o, prepTimeAdjustment: Math.max(-60, Math.min(180, o.prepTimeAdjustment + deltaMinutes)), updatedAt: now() }
          : o),
    }));
    _persistLocal(get);
    const order = get().orders.find(o => o.id === orderId);
    if (isSupabaseEnabled() && get().user?.id && order) {
      bridge.persistOrderUpdate(orderId, { prepTimeAdjustment: order.prepTimeAdjustment }).catch(() =>
        toast.error('Failed to sync prep time.'));
    }
  },

  // ── Settings ─────────────────────────────────────────────────────────────────

  // ── Ingredients ─────────────────────────────────────────────────────────────

  addIngredient(data) {
    const ingredient: Ingredient = { ...data, id: genId(), createdAt: now(), updatedAt: now() };
    set(s => ({ ingredients: [...s.ingredients, ingredient] }));
    _persistLocal(get);
    const { user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistNewIngredient(ingredient, user.id).catch(() =>
        toast.error('Failed to save ingredient.'));
    }
    return ingredient;
  },

  updateIngredient(id, updates) {
    set(s => ({
      ingredients: s.ingredients.map(i =>
        i.id === id ? { ...i, ...updates, updatedAt: now() } : i),
    }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistIngredientUpdate(id, updates).catch(() =>
        toast.error('Failed to update ingredient.'));
    }
  },

  deleteIngredient(id) {
    set(s => ({ ingredients: s.ingredients.filter(i => i.id !== id) }));
    _persistLocal(get);
    if (isSupabaseEnabled() && get().user?.id) {
      bridge.persistDeleteIngredient(id).catch(() =>
        toast.error('Failed to delete ingredient.'));
    }
  },

  // ── Stations ─────────────────────────────────────────────────────────────────

  addStation(station) {
    set(s => ({ settings: { ...s.settings, stations: [...(s.settings.stations ?? []), normalizeStation(station)] } }));
    _persistLocal(get);
    const { settings, user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistSettings(settings, user.id).catch(() =>
        toast.error('Failed to save station.'));
    }
  },

  updateStation(id, updates) {
    set(s => ({
      settings: {
        ...s.settings,
        stations: (s.settings.stations ?? []).map(st =>
          st.id === id ? normalizeStation({ ...st, ...updates }) : st,
        ),
      },
    }));
    _persistLocal(get);
    const { settings, user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistSettings(settings, user.id).catch(() =>
        toast.error('Failed to update station.'));
    }
  },

  deleteStation(id) {
    set(s => ({
      settings: {
        ...s.settings,
        stations: (s.settings.stations ?? []).filter(st => st.id !== id),
      },
    }));
    _persistLocal(get);
    const { settings, user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistSettings(settings, user.id).catch(() =>
        toast.error('Failed to delete station.'));
    }
  },

  // ── Kitchen Events ───────────────────────────────────────────────────────────

  logKitchenEvent(data) {
    const event: KitchenEvent = { ...data, id: genId(), createdAt: now() };
    set(s => ({ kitchenEvents: [event, ...s.kitchenEvents].slice(0, 500) }));
    _persistLocal(get);
    const { user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistKitchenEvent(event, user.id).catch(() => {/* best-effort, non-critical */});
    }
  },

  updateSettings(updates) {
    set(s => ({ settings: { ...s.settings, ...updates } }));
    _persistLocal(get);
    const { settings, user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistSettings(settings, user.id).catch(() =>
        toast.error('Failed to save settings.'));
    }
  },

  // ── Customer checkout ─────────────────────────────────────────────────────────

  validateCart(cart) {
    const { menuItems, settings } = get();
    const issues: CartValidationIssue[] = [];
    for (const cartItem of cart) {
      const item = menuItems.find(m => m.id === cartItem.menuItemId);
      if (!item) {
        issues.push({ menuItemId: cartItem.menuItemId, menuItemName: '(removed)', reason: 'item_not_found', available: 0, requested: cartItem.quantity });
        continue;
      }
      if (item.status !== 'active') {
        issues.push({ menuItemId: item.id, menuItemName: item.name, reason: 'item_disabled', available: 0, requested: cartItem.quantity });
        continue;
      }
      if (item.stock !== null) {
        const available = get().getAvailableStock(item.id);
        if (available <= 0 && settings.zeroStockBehavior === 'hide') {
          issues.push({ menuItemId: item.id, menuItemName: item.name, reason: 'out_of_stock', available: 0, requested: cartItem.quantity });
        } else if (available < cartItem.quantity) {
          issues.push({ menuItemId: item.id, menuItemName: item.name, reason: 'insufficient_stock', available, requested: cartItem.quantity });
        }
      }
      // Check required modifiers
      for (const mod of item.modifiers ?? []) {
        if (mod.required) {
          const hasSelection = cartItem.selectedModifiers.some(sm => sm.modifierId === mod.id);
          if (!hasSelection) {
            issues.push({ menuItemId: item.id, menuItemName: item.name, reason: 'missing_required_modifier', available: 0, requested: cartItem.quantity, modifierName: mod.name });
            break;
          }
        }
      }
    }
    return { valid: issues.length === 0, issues };
  },

  createReservation(sessionId, cart) {
    const { menuItems } = get();
    const now_ms = Date.now();
    set(s => ({ reservations: s.reservations.filter(r => r.expiresAt > now_ms) }));

    for (const cartItem of cart) {
      const item = menuItems.find(m => m.id === cartItem.menuItemId);
      if (!item || item.stock === null) continue;
      if (get().getAvailableStock(item.id) < cartItem.quantity) return false;
    }

    get().releaseReservation(sessionId);

    const reservation: StockReservation = {
      id:        genId(),
      sessionId,
      items:     cart.map(c => ({ menuItemId: c.menuItemId, quantity: c.quantity })),
      expiresAt: Date.now() + RESERVATION_TTL_MS,
    };
    set(s => ({ reservations: [...s.reservations, reservation] }));
    _persistLocal(get);

    const { user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistNewReservation(reservation, user.id).catch(() => {/* best-effort */});
    }
    return true;
  },

  releaseReservation(sessionId) {
    set(s => ({ reservations: s.reservations.filter(r => r.sessionId !== sessionId) }));
    _persistLocal(get);
    const { user } = get();
    if (isSupabaseEnabled() && user?.id) {
      bridge.persistReleaseReservation(sessionId, user.id).catch(() => {/* best-effort */});
    }
  },

  async checkout(payload) {
    const { cart, sessionId, tableId, paymentMethod, notes } = payload;

    // ── Supabase path: delegate entirely to atomic_checkout RPC ───────────────
    if (isSupabaseEnabled()) {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) return { success: false, error: 'Supabase not configured.', unavailableItems: [] };

      const userId = payload.restaurantUserId ?? get().user?.id;
      if (!userId) return { success: false, error: 'Restaurant not found.', unavailableItems: [] };

      // Resolve modifiers client-side before sending to RPC
      const { menuItems } = get();
      const resolvedCart = cart.map(ci => {
        const item = menuItems.find(m => m.id === ci.menuItemId);
        const resolvedModifiers = ci.selectedModifiers.map(sel => {
          const mod = item?.modifiers.find(m => m.id === sel.modifierId);
          const opt = mod?.options.find(o => o.id === sel.optionId);
          return mod && opt
            ? { modifierId: mod.id, modifierName: mod.name, optionId: opt.id, optionName: opt.name, priceAdjustment: opt.priceAdjustment }
            : null;
        }).filter(Boolean);
        return { menuItemId: ci.menuItemId, quantity: ci.quantity, resolvedModifiers };
      });

      const { data, error } = await supabase.rpc('atomic_checkout', {
        p_user_id:        userId,
        p_session_id:     sessionId,
        p_table_id:       tableId,
        p_payment_method: paymentMethod,
        p_cart:           resolvedCart,
        p_notes:          notes ?? '',
      });

      if (error) return { success: false, error: error.message, unavailableItems: [] };

      const result = data as Record<string, unknown>;
      if (!result.success) {
        return {
          success: false,
          error: (result.error as string) ?? 'Checkout failed.',
          unavailableItems: (result.unavailableItems as string[]) ?? [],
        };
      }

      // Build local Order and Receipt from RPC response to update Zustand
      const orderId    = result.orderId as string;
      const receiptId  = result.receiptId as string;
      const createdAt  = new Date(result.createdAt as string).toISOString();
      const items      = result.items as OrderItem[];

      const order: Order = {
        id:                  orderId,
        orderNumber:         result.orderNumber as number,
        tableId,
        tableName:           result.tableName as string,
        items,
        status:              'paid',
        subtotal:            result.subtotal as number,
        taxRate:             result.taxRate as number,
        taxAmount:           result.taxAmount as number,
        total:               result.total as number,
        paymentMethod:       paymentMethod as PaymentMethod,
        notes:               notes ?? '',
        estimatedPrepTime:   result.estimatedPrepTime as number,
        prepTimeAdjustment:  0,
        createdAt,
        paidAt:              createdAt,
        updatedAt:           createdAt,
      };

      const receipt: Receipt = {
        id:             receiptId,
        orderId,
        orderNumber:    result.orderNumber as number,
        tableId,
        tableName:      result.tableName as string,
        restaurantName: get().settings.businessName,
        items,
        subtotal:       result.subtotal as number,
        taxRate:        result.taxRate as number,
        taxAmount:      result.taxAmount as number,
        total:          result.total as number,
        paymentMethod:  paymentMethod as PaymentMethod,
        createdAt,
      };

      set(s => ({
        orders:   [order, ...s.orders],
        receipts: [receipt, ...s.receipts],
        nextOrderNumber: s.nextOrderNumber + 1,
        // Update stock counts and table status optimistically from RPC result
        menuItems: s.menuItems.map(m => {
          const orderItem = items.find(oi => oi.menuItemId === m.id);
          if (!orderItem || m.stock === null) return m;
          return { ...m, stock: Math.max(0, m.stock - orderItem.quantity), salesCount: m.salesCount + orderItem.quantity, updatedAt: createdAt };
        }),
        tables: tableId !== 'walk-in'
          ? s.tables.map(t => t.id === tableId ? { ...t, status: 'occupied' as TableStatus } : t)
          : s.tables,
      }));

      return { success: true, order, receipt };
    }

    // ── Local fallback (no Supabase) ──────────────────────────────────────────
    return _localCheckout(payload, get, set);
  },

  // ── Computed helpers ──────────────────────────────────────────────────────────

  getAvailableStock(itemId) {
    const { menuItems, reservations } = get();
    const item = menuItems.find(m => m.id === itemId);
    if (!item || item.stock === null) return Infinity;
    const now_ms = Date.now();
    const reserved = reservations
      .filter(r => r.expiresAt > now_ms)
      .flatMap(r => r.items)
      .filter(ri => ri.menuItemId === itemId)
      .reduce((sum, ri) => sum + ri.quantity, 0);
    return Math.max(0, item.stock - reserved);
  },

  getActiveOrders() {
    return get().orders.filter(o => isActiveOrder(o.status));
  },

  getTodayOrders() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return get().orders.filter(
      o => new Date(o.createdAt) >= startOfDay && isRevenueOrder(o.status),
    );
  },
}));

// ─── Local checkout (no Supabase) ────────────────────────────────────────────

function _localCheckout(
  payload: CheckoutPayload,
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
): CheckoutResult {
  const { cart, sessionId, tableId, paymentMethod, notes } = payload;
  const { menuItems, tables, settings, nextOrderNumber } = get();

  set(s => ({ reservations: s.reservations.filter(r => r.expiresAt > Date.now()) }));

  const unavailableItems: string[] = [];
  const orderItems: OrderItem[] = [];

  for (const cartItem of cart) {
    const menuItem = menuItems.find(m => m.id === cartItem.menuItemId);
    if (!menuItem || menuItem.status !== 'active') {
      unavailableItems.push(menuItem?.name ?? cartItem.menuItemId);
      continue;
    }
    if (menuItem.stock !== null) {
      const { reservations } = get();
      const otherReserved = reservations
        .filter(r => r.sessionId !== sessionId && r.expiresAt > Date.now())
        .flatMap(r => r.items)
        .filter(ri => ri.menuItemId === menuItem.id)
        .reduce((sum, ri) => sum + ri.quantity, 0);
      if (menuItem.stock - otherReserved < cartItem.quantity) {
        unavailableItems.push(menuItem.name);
        continue;
      }
    }

    const resolvedModifiers: OrderItemModifier[] = [];
    let modifierTotal = 0;
    for (const sel of cartItem.selectedModifiers) {
      const mod = menuItem.modifiers.find(m => m.id === sel.modifierId);
      const opt = mod?.options.find(o => o.id === sel.optionId);
      if (mod && opt) {
        resolvedModifiers.push({
          modifierId: mod.id, modifierName: mod.name,
          optionId: opt.id, optionName: opt.name,
          priceAdjustment: opt.priceAdjustment,
        });
        modifierTotal += opt.priceAdjustment;
      }
    }
    const unitPrice = menuItem.price + modifierTotal;
    orderItems.push({
      menuItemId: menuItem.id, menuItemName: menuItem.name, menuItemIcon: menuItem.icon,
      quantity: cartItem.quantity, unitPrice, modifiers: resolvedModifiers,
      lineTotal: unitPrice * cartItem.quantity,
    });
  }

  if (unavailableItems.length > 0) return { success: false, error: 'Some items are no longer available.', unavailableItems };
  if (orderItems.length === 0) return { success: false, error: 'Cart is empty.', unavailableItems: [] };

  for (const oi of orderItems) {
    const item = menuItems.find(m => m.id === oi.menuItemId);
    if (item?.stock !== null) {
      set(s => ({
        menuItems: s.menuItems.map(m =>
          m.id === oi.menuItemId && m.stock !== null
            ? { ...m, stock: Math.max(0, m.stock - oi.quantity), salesCount: m.salesCount + oi.quantity, updatedAt: now() }
            : m),
      }));
    }
  }

  const table = tables.find(t => t.id === tableId);
  const tableName = table?.name ?? tableId;
  const subtotal = orderItems.reduce((s, i) => s + i.lineTotal, 0);
  const taxRate = settings.taxRate;
  const taxAmount = settings.taxDisplay === 'exclusive' ? subtotal * (taxRate / 100) : 0;
  const total = subtotal + taxAmount;
  const maxPrep = Math.max(...orderItems.map(oi => {
    const m = menuItems.find(m => m.id === oi.menuItemId);
    return m ? m.prepTime : 10;
  }));
  const estimatedPrepTime = maxPrep + Math.max(0, orderItems.length - 1) * 2;
  const createdAt = now();

  const order: Order = {
    id: genId(), orderNumber: nextOrderNumber, tableId, tableName, items: orderItems,
    status: 'paid', subtotal, taxRate, taxAmount, total,
    paymentMethod: paymentMethod as PaymentMethod,
    notes: notes ?? '', estimatedPrepTime, prepTimeAdjustment: 0,
    createdAt, paidAt: createdAt, updatedAt: createdAt,
  };

  const receipt: Receipt = {
    id: genId(), orderId: order.id, orderNumber: nextOrderNumber,
    tableId, tableName, restaurantName: settings.businessName,
    items: orderItems, subtotal, taxRate, taxAmount, total,
    paymentMethod: paymentMethod as PaymentMethod, createdAt,
  };

  set(s => ({
    orders: [order, ...s.orders],
    receipts: [receipt, ...s.receipts],
    nextOrderNumber: s.nextOrderNumber + 1,
  }));
  if (table) set(s => ({ tables: s.tables.map(t => t.id === tableId ? { ...t, status: 'occupied' as TableStatus } : t) }));
  get().releaseReservation(sessionId);
  _persistLocal(get);

  return { success: true, order, receipt };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _restoreStock(
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  order: Order,
) {
  for (const oi of order.items) {
    const item = get().menuItems.find(m => m.id === oi.menuItemId);
    if (item?.stock !== null) {
      set(s => ({
        menuItems: s.menuItems.map(m =>
          m.id === oi.menuItemId && m.stock !== null
            ? { ...m, stock: m.stock + oi.quantity, updatedAt: now() } : m),
      }));
    }
  }
}

/** Persist workspace snapshot to localStorage (used only when Supabase is disabled). */
function _persistLocal(get: () => AppState) {
  if (isSupabaseEnabled() || !_activeUserId) return;
  const { menuItems, categories, tables, orders, receipts, settings, nextOrderNumber, reservations, ingredients, kitchenEvents, decorations } = get();
  saveWorkspaceStateLocal(_activeUserId, { menuItems, categories, tables, orders, receipts, settings, nextOrderNumber, reservations, ingredients, kitchenEvents, decorations });
}

// ─── Test utility ─────────────────────────────────────────────────────────────

export function _resetStoreForTesting() {
  _activeUserId = null;
  if (typeof localStorage !== 'undefined') localStorage.clear();
}
