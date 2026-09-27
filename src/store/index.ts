import { create } from 'zustand';
import { toast } from 'sonner';
import type {
  User, MenuItem, MenuItemStatus, Table, TableStatus,
  Order, OrderStatus, OrderItem, OrderItemModifier,
  Receipt, CartItem, StockReservation, BusinessSettings,
  CheckoutPayload, CheckoutResult, CartValidationResult, CartValidationIssue,
  PaymentMethod, Ingredient, KitchenEvent, Station, MapDecoration, DecorationType,
  CalendarEvent, CalendarEventStatus, EventPackage, CalendarSettings, WorkingDay, WorkingException,
  Employee, Shift, WeeklyDayTemplate,
} from '../domain/types';
import { DEFAULT_SETTINGS, DEMO_USER } from '../domain/initialData';
import { AUTH_KEY, WORKSPACE_KEY, defaultWorkspace, emptyWorkspace, normalizeWorkspace, loadWorkspaceStateLocal, saveWorkspaceStateLocal, type WorkspaceSnapshot } from './workspace';
import { advance, isActiveOrder, isRevenueOrder } from '../domain/orderMachine';
import { evaluateCheckout, groupModifierSelections } from '../domain/ordering/cart';
import { applyTransition } from '../domain/ordering/orderOperations';
import * as workspaceService from '../services/workspaceService';
import { normalizeStation } from '../domain/stations';
import { isSupabaseEnabled } from './flags';
import * as bridge from './bridge';

// ─── Utility ──────────────────────────────────────────────────────────────────

const genId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const RESERVATION_TTL_MS = 5 * 60 * 1000;

// Active local workspace is set by login and refresh through the same action.
let _activeUserId: string | null = null;
function usesSupabasePersistence(): boolean {
  return isSupabaseEnabled() && _activeUserId !== DEMO_USER.id;
}

// ─── State Shape ──────────────────────────────────────────────────────────────

export interface AppState extends WorkspaceSnapshot {
  _hasHydrated: boolean;

  user: User | null;
  isAuthenticated: boolean;

  hydrateWorkspace: (user: User, workspace: WorkspaceSnapshot, source?: 'local' | 'supabase') => void;
  restoreLocalSession: () => boolean;
  resetWorkspace: () => void;
  /** Public pages (menu, portal, station): load one restaurant's customer-facing data. */
  hydrateCustomerContext: (data: { settings: BusinessSettings; menuItems: MenuItem[]; tables: Table[] }) => void;
  /** Station devices: floor map + menu data from the session-gated station_get_context RPC. */
  hydrateStationContext: (data: { restaurantName: string; menuItems: MenuItem[]; tables: Table[]; decorations: MapDecoration[] }) => void;
  applyRemoteOrder: (order: Order) => void;
  applyRemoteMenuItem: (item: MenuItem) => void;
  applyRemoteTable: (table: Table) => void;

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

  /** Business-critical writes resolve to false (and toast) when rejected. */
  adjustStock:  (itemId: string, delta: number) => Promise<boolean>;
  setStock:     (itemId: string, stock: number) => Promise<boolean>;
  restockItem:  (itemId: string) => Promise<boolean>;

  /** Moves an order from `expected` to `next` (server state machine / local mirror). */
  transitionOrder:    (orderId: string, expected: OrderStatus, next: OrderStatus, actor?: string) => Promise<boolean>;
  advanceOrderStatus: (orderId: string) => Promise<boolean>;
  cancelOrder:        (orderId: string) => Promise<boolean>;
  refundOrder:        (orderId: string) => Promise<boolean>;
  adjustPrepTime:     (orderId: string, deltaMinutes: number) => void;

  updateSettings: (updates: Partial<BusinessSettings>) => Promise<boolean>;

  addIngredient:    (data: Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>) => Ingredient;
  updateIngredient: (id: string, updates: Partial<Omit<Ingredient, 'id' | 'createdAt'>>) => void;
  deleteIngredient: (id: string) => void;
  logKitchenEvent:  (data: Omit<KitchenEvent, 'id' | 'createdAt'>) => void;

  addStation:    (data: Station) => Promise<boolean>;
  /** `pin` non-empty sets a new PIN, `removePin` clears it, otherwise the PIN is kept. */
  updateStation: (id: string, updates: Partial<Station> & { removePin?: boolean }) => Promise<boolean>;
  deleteStation: (id: string) => Promise<boolean>;

  validateCart:       (cart: CartItem[]) => CartValidationResult;
  createReservation:  (sessionId: string, cart: CartItem[]) => boolean;
  releaseReservation: (sessionId: string) => void;
  checkout:           (payload: CheckoutPayload) => Promise<CheckoutResult>;

  getAvailableStock: (itemId: string) => number;
  getActiveOrders:   () => Order[];
  getTodayOrders:    () => Order[];

  // ── Calendar ────────────────────────────────────────────────────────────────
  addCalendarEvent:        (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => CalendarEvent;
  updateCalendarEvent:     (id: string, updates: Partial<Omit<CalendarEvent, 'id' | 'createdAt'>>) => void;
  deleteCalendarEvent:     (id: string) => void;
  approveCalendarEvent:    (id: string, approvedBy: string) => void;
  rejectCalendarEvent:     (id: string, reason?: string) => void;

  addEventPackage:    (data: Omit<EventPackage, 'id' | 'createdAt'>) => EventPackage;
  updateEventPackage: (id: string, updates: Partial<Omit<EventPackage, 'id' | 'createdAt'>>) => void;
  deleteEventPackage: (id: string) => void;

  updateCalendarSettings: (updates: Partial<CalendarSettings>) => void;

  // ── Employees ───────────────────────────────────────────────────────────────
  addEmployee:    (data: Omit<Employee, 'id' | 'createdAt'>) => Employee;
  updateEmployee: (id: string, updates: Partial<Omit<Employee, 'id' | 'createdAt'>>) => void;
  deleteEmployee: (id: string) => void;

  // ── Shifts ──────────────────────────────────────────────────────────────────
  addShift:             (data: Omit<Shift, 'id' | 'createdAt'>) => Shift;
  updateShift:          (id: string, updates: Partial<Omit<Shift, 'id' | 'createdAt'>>) => void;
  deleteShift:          (id: string) => void;
  /** Stamp out Shift records for the given ISO week (Monday date) from weekTemplate. Non-destructive. */
  applyWeekTemplate:    (mondayIsoDate: string) => void;
  updateWeekTemplate:   (template: WeeklyDayTemplate[]) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useStore = create<AppState>()((set, get) => ({
  _hasHydrated:    false,
  user:            null,
  isAuthenticated: false,
  ...emptyWorkspace(),

  hydrateWorkspace(user, workspace, source = 'supabase') {
    _activeUserId = source === 'local' ? user.id : null;
    set({ ...normalizeWorkspace(workspace), user, isAuthenticated: true, _hasHydrated: true });
  },

  restoreLocalSession() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      const auth = raw ? JSON.parse(raw) : null;
      if (auth?.user?.id && auth.isAuthenticated) {
        get().hydrateWorkspace(auth.user, loadWorkspaceStateLocal(auth.user.id, auth.user), 'local');
        return true;
      }
    } catch { /* Invalid authentication data must not expose a prior workspace. */ }
    get().resetWorkspace();
    return false;
  },

  resetWorkspace() {
    _activeUserId = null;
    set({ ...emptyWorkspace(), user: null, isAuthenticated: false, _hasHydrated: true });
  },

  hydrateCustomerContext({ settings, menuItems, tables }) {
    // Public context never carries station credentials or owner-only fields.
    set({ settings: { ...settings, stations: [] }, menuItems, tables, stations: [] });
  },

  hydrateStationContext({ restaurantName, menuItems, tables, decorations }) {
    set(s => ({ menuItems, tables, decorations, settings: { ...s.settings, businessName: restaurantName, stations: [] }, stations: [] }));
  },

  applyRemoteOrder(order) {
    set(s => ({ orders: s.orders.some(o => o.id === order.id)
      ? s.orders.map(o => o.id === order.id ? order : o) : [order, ...s.orders] }));
  },
  applyRemoteMenuItem(item) {
    set(s => ({ menuItems: s.menuItems.some(m => m.id === item.id)
      ? s.menuItems.map(m => m.id === item.id ? item : m) : [...s.menuItems, item] }));
  },
  applyRemoteTable(table) {
    set(s => ({ tables: s.tables.some(t => t.id === table.id)
      ? s.tables.map(t => t.id === table.id ? table : t) : [...s.tables, table] }));
  },

  // ── Auth ────────────────────────────────────────────────────────────────────

  async login(email, password) {
    // Demo account always uses local path regardless of Supabase
    if (email === 'demo@smartline.io' && password === 'demo1234') {
      _activeUserId = DEMO_USER.id;
      localStorage.setItem(AUTH_KEY, JSON.stringify({ user: DEMO_USER, isAuthenticated: true }));
      const workspace = loadWorkspaceStateLocal(DEMO_USER.id, DEMO_USER);
      get().hydrateWorkspace(DEMO_USER, workspace, 'local');
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

      get().hydrateWorkspace(user, workspace);

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
    get().hydrateWorkspace(foundUser, workspace, 'local');
    return { success: true };
  },

  async logout() {
    const cloudSession = isSupabaseEnabled() && get().user?.id !== DEMO_USER.id;
    localStorage.removeItem(AUTH_KEY);
    get().resetWorkspace();
    if (cloudSession) {
      const { supabase } = await import('@/lib/supabase/client');
      await supabase?.auth.signOut();
    }
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

      get().hydrateWorkspace(user, workspace);
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
    get().hydrateWorkspace(newUser, workspace, 'local');
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
    if (usesSupabasePersistence() && user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
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
    if (usesSupabasePersistence()) {
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
    if (usesSupabasePersistence() && get().user?.id) {
      const { categories, user } = get();
      import('@/lib/supabase/queries/settings').then(({ saveCategories }) =>
        saveCategories(user!.id, categories).catch(() =>
          toast.error('Failed to save category.')));
    }
  },

  deleteCategory(name) {
    set(s => ({ categories: s.categories.filter(c => c !== name) }));
    _persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      const { categories, user } = get();
      import('@/lib/supabase/queries/settings').then(({ saveCategories }) =>
        saveCategories(user!.id, categories).catch(() =>
          toast.error('Failed to delete category.')));
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
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistNewTable(table, get().user!.id).catch((err: unknown) =>
        toast.error(`Failed to save table: ${err instanceof Error ? err.message : String(err)}`));
    }
    return table;
  },

  updateTable(id, updates) {
    const prev = get().tables.find(t => t.id === id);
    set(s => ({ tables: s.tables.map(t => t.id === id ? { ...t, ...updates } : t) }));
    _persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistNewDecoration(dec, get().user!.id).catch((err: unknown) =>
        toast.error(`Failed to save decoration: ${err instanceof Error ? err.message : String(err)}`));
    }
    return dec;
  },

  updateDecoration(id, updates) {
    set(s => ({ decorations: s.decorations.map(d => d.id === id ? { ...d, ...updates } : d) }));
    _persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistDecorationUpdate(id, updates).catch(() =>
        toast.error('Failed to update decoration.'));
    }
  },

  deleteDecoration(id) {
    const prev = get().decorations.find(d => d.id === id);
    set(s => ({ decorations: s.decorations.filter(d => d.id !== id) }));
    _persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistTableUpdate(id, { status }).catch(() => {
        if (prev) set(s => ({ tables: s.tables.map(t => t.id === id ? prev : t) }));
        toast.error('Failed to update table status.');
      });
    }
  },

  // ── Stock ────────────────────────────────────────────────────────────────────

  async adjustStock(itemId, delta) {
    if (usesSupabasePersistence() && get().user?.id) {
      try { get().applyRemoteMenuItem(await workspaceService.adjustStock(itemId, delta)); return true; }
      catch (err) { toast.error(errorMessage(err, 'Failed to adjust stock.')); return false; }
    }
    set(s => ({
      menuItems: s.menuItems.map(i => {
        if (i.id !== itemId || i.stock === null) return i;
        return { ...i, stock: Math.max(0, i.stock + delta), updatedAt: now() };
      }),
    }));
    _persistLocal(get);
    return true;
  },

  async setStock(itemId, stock) {
    const item = get().menuItems.find(m => m.id === itemId);
    if (!item) return false;
    const value = Math.max(0, Math.floor(stock));
    if (usesSupabasePersistence() && get().user?.id) {
      try { get().applyRemoteMenuItem(await workspaceService.setStock(item, value)); return true; }
      catch (err) { toast.error(errorMessage(err, 'Failed to set stock.')); return false; }
    }
    set(s => ({ menuItems: s.menuItems.map(i => i.id === itemId ? { ...i, stock: value, updatedAt: now() } : i) }));
    _persistLocal(get);
    return true;
  },

  async restockItem(itemId) {
    const item = get().menuItems.find(m => m.id === itemId);
    if (!item || item.maxStock === null) return false;
    return get().setStock(itemId, item.maxStock);
  },

  // ── Orders ───────────────────────────────────────────────────────────────────

  async transitionOrder(orderId, expected, next, actor = 'owner') {
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        if (next === 'cancelled') {
          const result = await workspaceService.cancelOrder(orderId, get().user!.id);
          get().applyRemoteOrder(result.order);
          set({ menuItems: result.menuItems, tables: result.tables });
        } else {
          get().applyRemoteOrder(await workspaceService.transitionOrder(orderId, expected, next));
        }
        return true;
      } catch (err) {
        toast.error(errorMessage(err, 'Failed to update order.'));
        return false;
      }
    }
    const { orders, menuItems, tables } = get();
    const result = applyTransition({ orders, menuItems, tables }, orderId, expected, next, actor);
    if (!result.ok) { toast.error(result.error); return false; }
    set({ orders: result.orders, menuItems: result.menuItems, tables: result.tables });
    _persistLocal(get);
    return true;
  },

  async advanceOrderStatus(orderId) {
    const order = get().orders.find(o => o.id === orderId);
    const next = order ? advance(order.status) : null;
    if (!order || !next) return false;
    return get().transitionOrder(orderId, order.status, next);
  },

  async cancelOrder(orderId) {
    const order = get().orders.find(o => o.id === orderId);
    if (!order) return false;
    return get().transitionOrder(orderId, order.status, 'cancelled');
  },

  async refundOrder(orderId) {
    return get().transitionOrder(orderId, 'cancelled', 'refunded');
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
    if (usesSupabasePersistence() && get().user?.id && order) {
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
    if (usesSupabasePersistence() && user?.id) {
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
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistIngredientUpdate(id, updates).catch(() =>
        toast.error('Failed to update ingredient.'));
    }
  },

  deleteIngredient(id) {
    set(s => ({ ingredients: s.ingredients.filter(i => i.id !== id) }));
    _persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      bridge.persistDeleteIngredient(id).catch(() =>
        toast.error('Failed to delete ingredient.'));
    }
  },

  // ── Stations ─────────────────────────────────────────────────────────────────

  async addStation(station) {
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        const saved = await workspaceService.saveStation(stationPayload(station, station.pin ? station.pin : undefined));
        set(st => withStations(st, [...st.stations, saved]));
        return true;
      } catch (err) { toast.error(errorMessage(err, 'Failed to save station.')); return false; }
    }
    const normalized = normalizeStation({ ...station, hasPin: !!station.pin });
    set(st => withStations(st, [...st.stations, normalized]));
    _persistLocal(get);
    return true;
  },

  async updateStation(id, updates) {
    const current = get().stations.find(st => st.id === id);
    if (!current) return false;
    const { removePin, pin, ...rest } = updates;
    const nextPin = removePin ? '' : (pin ? pin : undefined);
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        const saved = await workspaceService.saveStation(stationPayload({ ...current, ...rest }, nextPin));
        set(st => withStations(st, st.stations.map(x => x.id === id ? saved : x)));
        return true;
      } catch (err) { toast.error(errorMessage(err, 'Failed to update station.')); return false; }
    }
    const localPin = nextPin === undefined ? current.pin : nextPin;
    const updated = normalizeStation({ ...current, ...rest, pin: localPin, hasPin: !!localPin });
    set(st => withStations(st, st.stations.map(x => x.id === id ? updated : x)));
    _persistLocal(get);
    return true;
  },

  async deleteStation(id) {
    if (usesSupabasePersistence() && get().user?.id) {
      try { await workspaceService.deleteStation(id); }
      catch (err) { toast.error(errorMessage(err, 'Failed to delete station.')); return false; }
    }
    set(st => withStations(st, st.stations.filter(x => x.id !== id)));
    _persistLocal(get);
    return true;
  },

  // ── Kitchen Events ───────────────────────────────────────────────────────────

  logKitchenEvent(data) {
    const event: KitchenEvent = { ...data, id: genId(), createdAt: now() };
    set(s => ({ kitchenEvents: [event, ...s.kitchenEvents].slice(0, 500) }));
    _persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistKitchenEvent(event, user.id).catch(() => {/* best-effort, non-critical */});
    }
  },

  async updateSettings(updates) {
    const prev = get().settings;
    set(s => ({ settings: { ...s.settings, ...updates, stations: s.stations } }));
    _persistLocal(get);
    if (usesSupabasePersistence() && get().user?.id) {
      try {
        // Patch only the changed fields: a stale full-row upsert could overwrite
        // concurrent edits from another device.
        const saved = await workspaceService.patchSettings(updates);
        set(s => ({ settings: { ...saved, stations: s.stations } }));
      } catch (err) {
        set(s => ({ settings: { ...prev, stations: s.stations } }));
        toast.error(errorMessage(err, 'Failed to save settings.'));
        return false;
      }
    }
    return true;
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
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewReservation(reservation, user.id).catch(() => {/* best-effort */});
    }
    return true;
  },

  releaseReservation(sessionId) {
    set(s => ({ reservations: s.reservations.filter(r => r.sessionId !== sessionId) }));
    _persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistReleaseReservation(sessionId, user.id).catch(() => {/* best-effort */});
    }
  },

  async checkout(payload) {
    const { cart, sessionId, tableId, paymentMethod, notes, scheduledFor } = payload;
    const clientOrderId = payload.clientOrderId ?? genId();

    // ── Supabase path: the RPC is authoritative for prices, stock and rules ──
    if (usesSupabasePersistence()) {
      const { supabase } = await import('@/lib/supabase/client');
      if (!supabase) return { success: false, error: 'Supabase not configured.', unavailableItems: [] };
      const token = payload.restaurantToken ?? get().settings?.restaurantToken;
      if (!token) return { success: false, error: 'Restaurant not found.', unavailableItems: [] };

      // Only identifiers and quantities leave the browser — never prices or names.
      const { data, error } = await supabase.rpc('atomic_checkout', {
        p_restaurant_token:  token,
        p_session_id:        sessionId,
        p_table_id:          tableId,
        p_payment_method:    paymentMethod,
        p_cart:              cart.map(ci => ({ menuItemId: ci.menuItemId, quantity: ci.quantity, selectedModifiers: groupModifierSelections(ci.selectedModifiers) })),
        p_notes:             notes ?? '',
        p_scheduled_for:     scheduledFor ?? '',
        p_client_order_id:   clientOrderId,
        p_customer_name:     payload.customerName ?? '',
        p_customer_phone:    payload.customerPhone ?? '',
        p_delivery_address:  payload.deliveryAddress ?? '',
      });
      if (error) return { success: false, error: error.message, unavailableItems: [] };

      const result = data as Record<string, unknown>;
      if (!result.success) {
        return { success: false, error: (result.error as string) ?? 'Checkout failed.', unavailableItems: (result.unavailableItems as string[]) ?? [] };
      }

      const createdAt = new Date(result.createdAt as string).toISOString();
      const items = result.items as OrderItem[];
      const channel = channelOfTable(tableId);
      const order: Order = {
        id: result.orderId as string, orderNumber: result.orderNumber as number, tableId,
        tableName: result.tableName as string, items, status: (result.status as OrderStatus) ?? 'paid',
        subtotal: Number(result.subtotal), taxRate: Number(result.taxRate), taxAmount: Number(result.taxAmount), total: Number(result.total),
        paymentMethod, paymentStatus: (result.paymentStatus as Order['paymentStatus']) ?? 'unpaid',
        notes: notes ?? '', scheduledFor: scheduledFor || undefined, orderChannel: channel,
        customerName: payload.customerName || undefined, customerPhone: payload.customerPhone || undefined,
        deliveryAddress: payload.deliveryAddress || undefined, clientOrderId,
        estimatedPrepTime: Number(result.estimatedPrepTime), prepTimeAdjustment: 0,
        createdAt, paidAt: createdAt, updatedAt: createdAt,
      };
      const receipt: Receipt = {
        id: result.receiptId as string, orderId: order.id, orderNumber: order.orderNumber, tableId,
        tableName: order.tableName, restaurantName: get().settings.businessName, items,
        subtotal: order.subtotal, taxRate: order.taxRate, taxAmount: order.taxAmount, total: order.total,
        paymentMethod, paymentStatus: order.paymentStatus, createdAt,
      };
      set(s => ({
        orders: s.orders.some(o => o.id === order.id) ? s.orders : [order, ...s.orders],
        receipts: s.receipts.some(r => r.id === receipt.id) ? s.receipts : [receipt, ...s.receipts],
        menuItems: s.menuItems.map(m => {
          const qty = items.filter(oi => oi.menuItemId === m.id).reduce((sum, oi) => sum + oi.quantity, 0);
          if (!qty || m.stock === null) return m;
          return { ...m, stock: Math.max(0, m.stock - qty), updatedAt: createdAt };
        }),
      }));
      return { success: true, order, receipt };
    }

    // ── Local fallback: same rules, evaluated by the shared domain module ────
    return _localCheckout({ ...payload, clientOrderId }, get, set);
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

  // ── Calendar ─────────────────────────────────────────────────────────────────

  addCalendarEvent(data) {
    const event: CalendarEvent = { ...data, id: genId(), createdAt: now(), updatedAt: now() };
    set(s => ({ calendarEvents: [event, ...s.calendarEvents] }));
    if (!get()._hasHydrated && _activeUserId && !usesSupabasePersistence()) {
      // Public-page path (booking tab): store isn't hydrated so _persistLocal would
      // overwrite the admin's full workspace with empty arrays. Do a surgical
      // read-modify-write instead — only splice the new event into calendarEvents.
      try {
        const raw = localStorage.getItem(WORKSPACE_KEY(_activeUserId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.state) {
            parsed.state.calendarEvents = [event, ...(parsed.state.calendarEvents ?? [])];
            localStorage.setItem(WORKSPACE_KEY(_activeUserId), JSON.stringify(parsed));
          }
        }
      } catch { /* ignore */ }
    } else {
      _persistLocal(get);
    }
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewCalendarEvent(event, user.id).catch(() =>
        toast.error('Failed to save event.'));
    }
    return event;
  },

  updateCalendarEvent(id, updates) {
    set(s => ({
      calendarEvents: s.calendarEvents.map(e =>
        e.id === id ? { ...e, ...updates, updatedAt: now() } : e),
    }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistCalendarEventUpdate(id, updates).catch(() =>
        toast.error('Failed to update event.'));
    }
  },

  deleteCalendarEvent(id) {
    set(s => ({ calendarEvents: s.calendarEvents.filter(e => e.id !== id) }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteCalendarEvent(id).catch(() =>
        toast.error('Failed to delete event.'));
    }
  },

  approveCalendarEvent(id, approvedBy) {
    const approvedAt = now();
    set(s => ({
      calendarEvents: s.calendarEvents.map(e =>
        e.id === id
          ? { ...e, status: 'approved' as CalendarEventStatus, approvedBy, approvedAt, updatedAt: now() }
          : e),
    }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistCalendarEventUpdate(id, { status: 'approved', approvedBy, approvedAt }).catch(() =>
        toast.error('Failed to approve event.'));
    }
  },

  rejectCalendarEvent(id, reason) {
    set(s => ({
      calendarEvents: s.calendarEvents.map(e =>
        e.id === id
          ? { ...e, status: 'rejected' as CalendarEventStatus, rejectionReason: reason ?? '', updatedAt: now() }
          : e),
    }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistCalendarEventUpdate(id, { status: 'rejected', rejectionReason: reason ?? '' }).catch(() =>
        toast.error('Failed to reject event.'));
    }
  },

  addEventPackage(data) {
    const pkg: EventPackage = { ...data, id: genId(), createdAt: now() };
    set(s => ({ eventPackages: [...s.eventPackages, pkg] }));
    _persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewEventPackage(pkg, user.id).catch(() =>
        toast.error('Failed to save package.'));
    }
    return pkg;
  },

  updateEventPackage(id, updates) {
    set(s => ({
      eventPackages: s.eventPackages.map(p => p.id === id ? { ...p, ...updates } : p),
    }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistEventPackageUpdate(id, updates).catch(() =>
        toast.error('Failed to update package.'));
    }
  },

  deleteEventPackage(id) {
    set(s => ({ eventPackages: s.eventPackages.filter(p => p.id !== id) }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteEventPackage(id).catch(() =>
        toast.error('Failed to delete package.'));
    }
  },

  updateCalendarSettings(updates) {
    set(s => ({ calendarSettings: { ...s.calendarSettings, ...updates } }));
    _persistLocal(get);
    const { calendarSettings, user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistCalendarSettings(calendarSettings, user.id).catch(() =>
        toast.error('Failed to save calendar settings.'));
    }
  },

  // ── Employees ────────────────────────────────────────────────────────────────

  addEmployee(data) {
    const emp: Employee = { ...data, id: genId(), createdAt: now() };
    set(s => ({ employees: [...s.employees, emp] }));
    _persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewEmployee(emp, user.id).catch(() =>
        toast.error('Failed to save employee.'));
    }
    return emp;
  },

  updateEmployee(id, updates) {
    set(s => ({ employees: s.employees.map(e => e.id === id ? { ...e, ...updates } : e) }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistEmployeeUpdate(id, updates).catch(() =>
        toast.error('Failed to update employee.'));
    }
  },

  deleteEmployee(id) {
    // Remove employee from all shifts before deleting
    set(s => ({
      employees: s.employees.filter(e => e.id !== id),
      shifts: s.shifts.map(sh => ({
        ...sh,
        assignments: sh.assignments.filter(a => a.employeeId !== id),
      })),
    }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteEmployee(id).catch(() =>
        toast.error('Failed to delete employee.'));
    }
  },

  // ── Shifts ────────────────────────────────────────────────────────────────────

  addShift(data) {
    const shift: Shift = { ...data, id: genId(), createdAt: now() };
    set(s => ({ shifts: [...s.shifts, shift] }));
    _persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewShift(shift, user.id).catch(() =>
        toast.error('Failed to save shift.'));
    }
    return shift;
  },

  updateShift(id, updates) {
    set(s => ({ shifts: s.shifts.map(sh => sh.id === id ? { ...sh, ...updates } : sh) }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistShiftUpdate(id, updates).catch(() =>
        toast.error('Failed to update shift.'));
    }
  },

  deleteShift(id) {
    set(s => ({ shifts: s.shifts.filter(sh => sh.id !== id) }));
    _persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteShift(id).catch(() =>
        toast.error('Failed to delete shift.'));
    }
  },

  applyWeekTemplate(mondayIsoDate) {
    const { calendarSettings, shifts } = get();
    const template = calendarSettings.weekTemplate ?? [];
    if (!template.length) { toast.info('Define a default week template first.'); return; }

    // Build target date for each day-of-week in the week starting on mondayIsoDate
    const monday = new Date(mondayIsoDate + 'T12:00:00');
    const toCreate: Omit<Shift, 'id' | 'createdAt'>[] = [];

    for (const dayTpl of template) {
      // JS dayOfWeek: 1=Mon…6=Sat, 0=Sun. Map to offset from Monday (0–6).
      const offset = dayTpl.dayOfWeek === 0 ? 6 : dayTpl.dayOfWeek - 1;
      const d = new Date(monday);
      d.setDate(monday.getDate() + offset);
      const dateStr = d.toISOString().slice(0, 10);

      for (const slot of dayTpl.slots) {
        const exists = shifts.some(s => s.date === dateStr && s.name === slot.name);
        if (!exists) {
          toCreate.push({
            date: dateStr, name: slot.name,
            startTime: slot.startTime, endTime: slot.endTime,
            color: slot.color, minStaff: slot.minStaff,
            stationId: slot.stationId, assignments: [], notes: '',
          });
        }
      }
    }

    if (!toCreate.length) { toast.info('All template shifts already exist for this week.'); return; }

    const newShifts: Shift[] = toCreate.map(s => ({ ...s, id: genId(), createdAt: now() }));
    set(s => ({ shifts: [...s.shifts, ...newShifts] }));
    _persistLocal(get);

    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      for (const shift of newShifts) {
        bridge.persistNewShift(shift, user.id).catch(() =>
          toast.error('Failed to save shift.'));
      }
    }
    toast.success(`${newShifts.length} shift${newShifts.length !== 1 ? 's' : ''} created from template`);
  },

  updateWeekTemplate(template) {
    const updates = { weekTemplate: template };
    set(s => ({ calendarSettings: { ...s.calendarSettings, ...updates } }));
    _persistLocal(get);
    const { calendarSettings, user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistCalendarSettings(calendarSettings, user.id).catch(() =>
        toast.error('Failed to save week template.'));
    }
  },
}));

// ─── Local checkout (no Supabase) ────────────────────────────────────────────

function _localCheckout(
  payload: CheckoutPayload & { clientOrderId: string },
  get: () => AppState,
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
): CheckoutResult {
  const state = get();
  const existing = state.orders.find(o => o.clientOrderId === payload.clientOrderId);
  if (existing) {
    const receipt = state.receipts.find(r => r.orderId === existing.id);
    if (receipt) return { success: true, order: existing, receipt };
  }

  const nowDate = new Date();
  const evaluation = evaluateCheckout(
    { ...payload, notes: payload.notes ?? '' },
    { menuItems: state.menuItems, tables: state.tables, settings: state.settings, reservations: state.reservations, now: nowDate },
  );
  if (!evaluation.ok) return { success: false, error: evaluation.error, unavailableItems: evaluation.unavailableItems };

  const createdAt = nowDate.toISOString();
  const { items, channel } = evaluation;
  const order: Order = {
    id: genId(), orderNumber: state.nextOrderNumber, tableId: payload.tableId, tableName: evaluation.tableName, items,
    status: 'paid', subtotal: evaluation.subtotal, taxRate: state.settings.taxRate, taxAmount: evaluation.taxAmount,
    total: evaluation.total, paymentMethod: payload.paymentMethod, paymentStatus: 'unpaid',
    notes: payload.notes ?? '', scheduledFor: payload.scheduledFor || undefined, orderChannel: channel,
    customerName: payload.customerName?.trim() || undefined, customerPhone: payload.customerPhone?.trim() || undefined,
    deliveryAddress: channel === 'delivery' ? payload.deliveryAddress?.trim() : undefined,
    clientOrderId: payload.clientOrderId,
    estimatedPrepTime: evaluation.estimatedPrepTime, prepTimeAdjustment: 0,
    createdAt, paidAt: createdAt, updatedAt: createdAt,
  };
  const receipt: Receipt = {
    id: genId(), orderId: order.id, orderNumber: order.orderNumber, tableId: payload.tableId, tableName: order.tableName,
    restaurantName: state.settings.businessName, items, subtotal: order.subtotal, taxRate: order.taxRate,
    taxAmount: order.taxAmount, total: order.total, paymentMethod: payload.paymentMethod, paymentStatus: 'unpaid', createdAt,
  };
  const sold: Record<string, number> = {};
  for (const item of items) sold[item.menuItemId] = (sold[item.menuItemId] ?? 0) + item.quantity;

  // One state update: stock, counters, order, receipt, table and reservation together.
  set(s => ({
    menuItems: s.menuItems.map(m => {
      const qty = sold[m.id];
      if (!qty) return m;
      return { ...m, stock: m.stock === null ? null : m.stock - qty, salesCount: m.salesCount + qty, updatedAt: createdAt };
    }),
    orders: [order, ...s.orders],
    receipts: [receipt, ...s.receipts],
    nextOrderNumber: s.nextOrderNumber + 1,
    tables: channel === 'dine-in' ? s.tables.map(t => t.id === payload.tableId ? { ...t, status: 'occupied' as TableStatus } : t) : s.tables,
    reservations: s.reservations.filter(r => r.sessionId !== payload.sessionId && r.expiresAt > nowDate.getTime()),
  }));
  _persistLocal(get);
  return { success: true, order, receipt };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function channelOfTable(tableId: string): Order['orderChannel'] {
  return tableId === 'takeaway' || tableId === 'delivery' ? tableId : 'dine-in';
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Keeps the two station views (top-level slice + settings mirror) identical. */
function withStations(state: AppState, stations: Station[]): Partial<AppState> {
  return { stations, settings: { ...state.settings, stations } };
}

/** Server payload for upsert_station; `pin` present only when it should change. */
function stationPayload(station: Station, pin: string | undefined): Station & { pin?: string } {
  const { hasPin: _hasPin, pin: _pin, ...rest } = station;
  return (pin === undefined ? rest : { ...rest, pin }) as Station & { pin?: string };
}

/** Persist workspace snapshot to localStorage (used only when Supabase is disabled). */
function _persistLocal(get: () => AppState) {
  if (usesSupabasePersistence() || !_activeUserId) return;
  try { saveWorkspaceStateLocal(_activeUserId, get()); }
  catch { toast.error('Local storage is full. Your latest changes could not be saved.'); }
}

// ─── Cross-tab sync (local mode only) ────────────────────────────────────────
// The storage event fires in every tab EXCEPT the one that wrote the value.
// This keeps the admin tab live when a customer tab calls checkout() or submits
// a booking — no page refresh needed.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (usesSupabasePersistence() || !_activeUserId) return;
    if (e.key !== WORKSPACE_KEY(_activeUserId) || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (!parsed?.state) return;
      const { user, _hasHydrated } = useStore.getState();
      if (!_hasHydrated) {
        // Public pages (booking, station, etc.) — store not hydrated.
        // Only patch in the fields that public pages need so they stay live
        // without clobbering or restoring anything else.
        const { calendarEvents, orders } = parsed.state;
        const patch: Partial<AppState> = {};
        if (calendarEvents) patch.calendarEvents = calendarEvents;
        if (orders)         patch.orders         = orders;
        if (Object.keys(patch).length) useStore.setState(patch);
        return;
      }
      if (!user) return;
      const fresh = loadWorkspaceStateLocal(_activeUserId, user);
      useStore.getState().hydrateWorkspace(user, fresh, 'local');
    } catch { /* ignore */ }
  });
}

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Read settings directly from localStorage (bypasses the in-memory store).
 * Use in public pages whose Zustand store is unhydrated — e.g. OrderPortal,
 * BookingPage — so they always see the latest admin-saved values.
 */
export function getPersistedSettings(): BusinessSettings | null {
  if (usesSupabasePersistence() || !_activeUserId) return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY(_activeUserId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.settings) return { ...DEFAULT_SETTINGS, ...parsed.state.settings };
    }
  } catch { /* ignore */ }
  return null;
}

// ─── Test utility ─────────────────────────────────────────────────────────────

export function _resetStoreForTesting() {
  _activeUserId = null;
  if (typeof localStorage !== 'undefined') localStorage.clear();
}
