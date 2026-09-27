/** Store state + action contract. Implementations live in ./slices. */
import type { User, MenuItem, MenuItemStatus, Table, TableStatus, Order, OrderStatus, CartItem, BusinessSettings, CheckoutPayload, CheckoutResult, CartValidationResult, Ingredient, KitchenEvent, Station, MapDecoration, DecorationType, CalendarEvent, EventPackage, CalendarSettings, Employee, Shift, WeeklyDayTemplate } from '../domain/types';
import { type WorkspaceSnapshot } from './workspace';

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
  /** Merge authoritative rows by id (visibility refresh); never drops unseen orders. */
  mergeRemoteOrders: (orders: Order[]) => void;
  applyRemoteKitchenEvent: (event: KitchenEvent) => void;
  applyRemoteCalendarEvent: (event: CalendarEvent) => void;
  applyRemoteMenuItem: (item: MenuItem) => void;
  applyRemoteTable: (table: Table) => void;

  login:  (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  signup: (data: { email: string; password: string; name: string; businessName: string }) => Promise<{ success: boolean; error?: string }>;

  addMenuItem:       (data: Omit<MenuItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'salesCount'>) => MenuItem;
  updateMenuItem:    (id: string, updates: Partial<Omit<MenuItem, 'id' | 'createdAt'>>) => void;
  deleteMenuItem:    (id: string) => void;
  setMenuItemStatus: (id: string, status: MenuItemStatus) => void;
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
  /** Record an in-person payment (payment state only; kitchen status untouched). */
  recordPayment:      (orderId: string) => Promise<boolean>;
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

