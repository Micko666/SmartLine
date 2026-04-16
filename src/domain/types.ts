// ─── Auth ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  businessName: string;
  role: 'admin' | 'manager';
  createdAt: string;
}

// ─── Menu ────────────────────────────────────────────────────────────────────

export type MenuItemStatus = 'active' | 'archived' | 'disabled';

export interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
}

export interface Modifier {
  id: string;
  name: string;
  options: ModifierOption[];
  required: boolean;
  maxSelections: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  prepTime: number;        // minutes
  stock: number | null;    // null = unlimited
  maxStock: number | null;
  status: MenuItemStatus;
  icon: string;            // emoji fallback
  imageUrl: string;        // full food photo (base64 or URL)
  thumbnailUrl: string;    // small icon/thumb
  tags: string[];
  /** Structured allergen list — shown to customers and used for dietary filtering. */
  allergens?: string[];    // 'gluten' | 'dairy' | 'eggs' | 'nuts' | 'peanuts' | 'soy' | 'shellfish' | 'fish' | 'sesame'
  /** Structured dietary labels — vegetarian, vegan, gluten-free, etc. */
  dietaryTags?: string[];  // 'vegetarian' | 'vegan' | 'gluten-free' | 'dairy-free' | 'halal' | 'kosher' | 'spicy'
  /** Approximate calories per serving — shown on customer menu. */
  calories?: number;
  /** Cost to produce one serving — auto-calculated from recipe; used for margin and COGS analytics. */
  costPerServing?: number;
  /** Recipe: links this item to ingredients with quantities. */
  recipe?: RecipeIngredient[];
  modifiers: Modifier[];
  sortOrder: number;
  salesCount: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export type TableStatus = 'available' | 'occupied' | 'reserved';
export type TableShape = 'square' | 'round' | 'bar' | 'l-shape';

// ─── Map Decorations ──────────────────────────────────────────────────────────

/** Purely visual floor-map props — no orders, no QR, just layout context. */
export type DecorationType = 'door' | 'plant' | 'pillar' | 'window' | 'stairs' | 'wall';

export interface MapDecoration {
  id: string;
  type: DecorationType;
  x: number;
  y: number;
  w: number;
  h: number;
  floor?: string;
  rotation: number;  // 0 | 90 | 180 | 270
}

export interface Table {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: TableStatus;
  /** Physical shape hint — square, round, or bar/counter. */
  shape: TableShape;
  /** Zone/area label — "Dining Room", "Bar", "Terrace". Used for zone backgrounds on the floor map. */
  zone?: string;
  /** Floor/room label — "Ground Floor", "Terrace", "Rooftop". Used as a tab-level filter in the floor map. */
  floor?: string;
  /** Visual rotation in degrees (0 | 90 | 180 | 270). Meaningful for l-shape tables. */
  rotation?: number;
  /** Canvas X position (pixels). Null = auto-layout on first render. */
  x?: number | null;
  /** Canvas Y position (pixels). Null = auto-layout on first render. */
  y?: number | null;
  /** Visual size multiplier (0.4–3.0). 1.0 = default capacity-based size. */
  sizeScale?: number;
  createdAt: string;
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'paid'
  | 'preparing'
  | 'ready'
  | 'completed'
  | 'cancelled'
  | 'refunded';

export type PaymentMethod = 'card' | 'cash' | 'google_pay' | 'apple_pay';

export interface OrderItemModifier {
  modifierId: string;
  modifierName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;
}

export interface OrderItem {
  menuItemId: string;
  menuItemName: string;
  menuItemIcon: string;
  quantity: number;
  unitPrice: number;
  modifiers: OrderItemModifier[];
  lineTotal: number;
}

export interface Order {
  id: string;
  orderNumber: number;
  tableId: string;
  tableName: string;
  items: OrderItem[];
  status: OrderStatus;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  notes: string;
  estimatedPrepTime: number;
  prepTimeAdjustment: number; // manual admin adjustment in minutes
  createdAt: string;
  paidAt: string;
  updatedAt: string;
}

// ─── Receipts ────────────────────────────────────────────────────────────────

export interface Receipt {
  id: string;
  orderId: string;
  orderNumber: number;
  tableId: string;
  tableName: string;
  restaurantName: string;
  items: OrderItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  createdAt: string;
}

// ─── Cart / Customer Session ─────────────────────────────────────────────────

export interface CartItemModifier {
  modifierId: string;
  optionId: string;
}

export interface CartItem {
  menuItemId: string;
  quantity: number;
  selectedModifiers: CartItemModifier[];
}

// ─── Ingredients & Recipe ────────────────────────────────────────────────────

export interface Ingredient {
  id: string;
  name: string;
  unit: string;           // 'g' | 'kg' | 'ml' | 'l' | 'pcs' | 'oz' | 'lb'
  costPerUnit: number;    // cost in restaurant's currency per unit
  stock?: number;         // optional stock tracking
  createdAt: string;
  updatedAt: string;
}

export interface RecipeIngredient {
  ingredientId: string;
  quantity: number;       // quantity per serving in ingredient's unit
}

// ─── Kitchen Events ───────────────────────────────────────────────────────────

export type KitchenEventType = 'waste' | 'remake' | 'delay' | 'note';

export interface KitchenEvent {
  id: string;
  orderId: string;
  orderNumber: number;
  type: KitchenEventType;
  notes: string;
  menuItemId?: string;
  menuItemName?: string;
  quantity?: number;
  estimatedCost?: number;
  /** Station that logged this event — enables per-station analytics. */
  stationId?: string;
  createdAt: string;
}

// ─── Stock Reservations ───────────────────────────────────────────────────────

export interface StockReservation {
  id: string;
  sessionId: string;
  items: { menuItemId: string; quantity: number }[];
  expiresAt: number; // timestamp ms — auto-expire after 5 minutes
}

// ─── Station Profiles ─────────────────────────────────────────────────────────

export type StationRole = 'kitchen' | 'service' | 'bar' | 'custom';

export type CategoryMode = 'all' | 'focus' | 'exclusive';

export interface StationPermissions {
  canAdvanceOrders: boolean;
  canCancelOrders: boolean;
  canLogKitchenEvents: boolean;
  /** Adjust prep time estimates (+/- minutes) on orders */
  canAdjustPrepTime: boolean;
  /** Send orders back for rework / remake */
  canReworkOrders: boolean;
  /** Show the production summary rail (aggregated incoming item counts) */
  showProductionSummary: boolean;
  mapAccess: boolean;
  canUpdateTableStatus: boolean;
  /**
   * Allow repositioning / adding / deleting tables on the floor map.
   * Separate from canUpdateTableStatus (operational) — this is layout editing.
   * Typically false for all station roles; reserved for manager-level access.
   */
  canEditTableLayout: boolean;
  /** empty array = show all categories; used by bar to show only drink items */
  filterCategories: string[];
  categoryMode: CategoryMode;
  visibleStatuses: OrderStatus[];
}

export interface Station {
  id: string;
  name: string;
  role: StationRole;
  pin: string;
  color: string;
  permissions: StationPermissions;
  createdAt: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export interface BusinessSettings {
  businessName: string;
  businessType: string;
  currency: string;
  currencySymbol: string;
  taxRate: number;
  taxDisplay: 'inclusive' | 'exclusive' | 'hidden';
  language: string;
  timezone: string;
  openingHours: string;
  serviceMode: string;
  lowStockThreshold: number;
  zeroStockBehavior: 'hide' | 'disable';
  appUrl: string;
  logoUrl: string;
  /** Stable token used to scope customer sessions per restaurant. Embedded in QR URLs. */
  restaurantToken: string;
  /**
   * Station profiles — persisted here for Supabase JSONB compatibility.
   * Runtime reads should use the top-level `stations` store slice instead.
   * @internal
   */
  stations?: Station[];
}

// ─── Checkout ────────────────────────────────────────────────────────────────

export interface CheckoutPayload {
  sessionId: string;
  tableId: string;
  paymentMethod: PaymentMethod;
  cart: CartItem[];
  notes?: string;
  restaurantUserId?: string; // set by customer menu (unauthenticated checkout)
}

export type CheckoutResult =
  | { success: true; order: Order; receipt: Receipt }
  | { success: false; error: string; unavailableItems: string[] };

// ─── Cart Validation ─────────────────────────────────────────────────────────

export interface CartValidationIssue {
  menuItemId: string;
  menuItemName: string;
  reason: 'out_of_stock' | 'insufficient_stock' | 'item_disabled' | 'item_not_found' | 'missing_required_modifier';
  available: number;
  requested: number;
  /** Set when reason is missing_required_modifier */
  modifierName?: string;
}

export interface CartValidationResult {
  valid: boolean;
  issues: CartValidationIssue[];
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  todayRevenue: number;
  todayOrders: number;
  activeOrders: number;
  avgPrepTime: number;
  lowStockCount: number;
  completionRate: number;
}
