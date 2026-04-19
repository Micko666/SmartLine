/**
 * Store integration tests: checkout, stock deduction, cart validation,
 * table-linked order creation, stock conflict handling, workspace isolation.
 *
 * Uses Zustand with no persistence (localStorage not available in jsdom by default).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, _resetStoreForTesting } from '../store';
import { SEED_MENU_ITEMS, SEED_TABLES } from '../domain/initialData';
import type { CartItem } from '../domain/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function freshStore() {
  // Clear localStorage and reset the module-level _activeUserId so tests
  // cannot contaminate each other via per-user workspace keys.
  _resetStoreForTesting();

  // Reset to a known fixture state that isolates the logic being tested.
  useStore.setState({
    _hasHydrated: true,
    user: null,
    isAuthenticated: false,
    menuItems: [
      {
        id: 'item-a', name: 'Pizza', description: 'Tomato, cheese', category: 'Food',
        price: 12.00, prepTime: 10, stock: 5, maxStock: 20, status: 'active',
        icon: '🍕', imageUrl: '', thumbnailUrl: '', tags: [], modifiers: [],
        sortOrder: 1, salesCount: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'item-b', name: 'Coke', description: 'Cold', category: 'Drinks',
        price: 2.50, prepTime: 1, stock: 2, maxStock: 10, status: 'active',
        icon: '🥤', imageUrl: '', thumbnailUrl: '', tags: [], modifiers: [],
        sortOrder: 2, salesCount: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'item-c', name: 'Tiramisu', description: 'Classic', category: 'Desserts',
        price: 8.00, prepTime: 2, stock: 0, maxStock: 10, status: 'active',
        icon: '🍰', imageUrl: '', thumbnailUrl: '', tags: [], modifiers: [],
        sortOrder: 3, salesCount: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'item-d', name: 'Wagyu', description: 'Premium', category: 'Specials',
        price: 35.00, prepTime: 20, stock: 1, maxStock: 5, status: 'active',
        icon: '🥩', imageUrl: '', thumbnailUrl: '', tags: [], modifiers: [],
        sortOrder: 4, salesCount: 0, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
      },
    ],
    categories: ['Food', 'Drinks', 'Desserts', 'Specials'],
    tables: [
      { id: 'tbl-1', number: 1, name: 'Table 1', capacity: 4, status: 'available', createdAt: '2024-01-01T00:00:00.000Z' },
    ],
    orders: [],
    receipts: [],
    settings: {
      businessName: 'Test Restaurant', businessType: 'Restaurant',
      currency: 'EUR', currencySymbol: '€',
      taxRate: 10, taxDisplay: 'inclusive',
      language: 'English', timezone: 'UTC', openingHours: '09:00-22:00', serviceMode: 'dine-in',
      lowStockThreshold: 3, zeroStockBehavior: 'disable',
      appUrl: 'http://localhost:8080', logoUrl: '',
    },
    nextOrderNumber: 1001,
    reservations: [],
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

describe('auth', () => {
  beforeEach(() => { freshStore(); });

  it('demo account logs in with correct credentials', async () => {
    const result = await useStore.getState().login('demo@smartline.io', 'demo1234');
    expect(result.success).toBe(true);
    expect(useStore.getState().isAuthenticated).toBe(true);
    expect(useStore.getState().user?.email).toBe('demo@smartline.io');
  });

  it('rejects wrong password', async () => {
    const result = await useStore.getState().login('demo@smartline.io', 'wrongpass');
    expect(result.success).toBe(false);
    expect(useStore.getState().isAuthenticated).toBe(false);
  });

  it('logout clears auth', async () => {
    await useStore.getState().login('demo@smartline.io', 'demo1234');
    await useStore.getState().logout();
    expect(useStore.getState().isAuthenticated).toBe(false);
    expect(useStore.getState().user).toBeNull();
  });
});

// ── validateCart ──────────────────────────────────────────────────────────────

describe('validateCart', () => {
  beforeEach(() => { freshStore(); });

  it('returns valid for available items within stock', () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 3, selectedModifiers: [] }];
    const result = useStore.getState().validateCart(cart);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('detects item requesting more than stock', () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 10, selectedModifiers: [] }];
    const result = useStore.getState().validateCart(cart);
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe('insufficient_stock');
    expect(result.issues[0].available).toBe(5);
    expect(result.issues[0].requested).toBe(10);
  });

  it('detects out-of-stock item when behavior is hide', () => {
    useStore.setState(s => ({ settings: { ...s.settings, zeroStockBehavior: 'hide' } }));
    const cart: CartItem[] = [{ menuItemId: 'item-c', quantity: 1, selectedModifiers: [] }];
    const result = useStore.getState().validateCart(cart);
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe('out_of_stock');
  });

  it('allows out-of-stock item when behavior is disable (still blocked at checkout)', () => {
    // With 'disable' behavior, validateCart only checks status, not stock === 0
    useStore.setState(s => ({ settings: { ...s.settings, zeroStockBehavior: 'disable' } }));
    const cart: CartItem[] = [{ menuItemId: 'item-c', quantity: 1, selectedModifiers: [] }];
    // Still fails because available stock = 0 < requested 1
    const result = useStore.getState().validateCart(cart);
    expect(result.valid).toBe(false);
  });

  it('detects disabled item', () => {
    useStore.setState(s => ({
      menuItems: s.menuItems.map(i => i.id === 'item-a' ? { ...i, status: 'disabled' as const } : i),
    }));
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 1, selectedModifiers: [] }];
    const result = useStore.getState().validateCart(cart);
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe('item_disabled');
  });

  it('detects non-existent item', () => {
    const cart: CartItem[] = [{ menuItemId: 'nonexistent', quantity: 1, selectedModifiers: [] }];
    const result = useStore.getState().validateCart(cart);
    expect(result.valid).toBe(false);
    expect(result.issues[0].reason).toBe('item_not_found');
  });
});

// ── checkout ──────────────────────────────────────────────────────────────────

describe('checkout', () => {
  beforeEach(() => { freshStore(); });

  it('creates order and receipt for valid cart', async () => {
    const cart: CartItem[] = [
      { menuItemId: 'item-a', quantity: 2, selectedModifiers: [] },
      { menuItemId: 'item-b', quantity: 1, selectedModifiers: [] },
    ];
    const result = await useStore.getState().checkout({
      sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.order.status).toBe('paid');
    expect(result.order.tableId).toBe('tbl-1');
    expect(result.order.tableName).toBe('Table 1');
    expect(result.order.items).toHaveLength(2);
    expect(result.order.total).toBeCloseTo(26.50, 1); // 2*12 + 2.5
    expect(result.receipt.orderId).toBe(result.order.id);
    expect(result.receipt.restaurantName).toBe('Test Restaurant');
  });

  it('deducts stock correctly after checkout', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 2, selectedModifiers: [] }];
    await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    const item = useStore.getState().menuItems.find(m => m.id === 'item-a');
    expect(item?.stock).toBe(3); // started at 5, ordered 2
  });

  it('increments salesCount after checkout', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 3, selectedModifiers: [] }];
    await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    const item = useStore.getState().menuItems.find(m => m.id === 'item-a');
    expect(item?.salesCount).toBe(3);
  });

  it('order immediately appears in admin orders list', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-b', quantity: 1, selectedModifiers: [] }];
    await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    expect(useStore.getState().orders).toHaveLength(1);
    expect(useStore.getState().orders[0].status).toBe('paid');
  });

  it('increments orderNumber for each order', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 1, selectedModifiers: [] }];
    const r1 = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    const r2 = await useStore.getState().checkout({ sessionId: 'sess-2', tableId: 'tbl-1', paymentMethod: 'card', cart });
    if (!r1.success || !r2.success) return;
    expect(r2.order.orderNumber).toBe(r1.order.orderNumber + 1);
  });

  it('fails if stock is exhausted', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 10, selectedModifiers: [] }]; // only 5 in stock
    const result = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.unavailableItems).toContain('Pizza');
  });

  it('fails on empty cart', async () => {
    const result = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart: [] });
    expect(result.success).toBe(false);
  });

  it('marks table as occupied after checkout', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 1, selectedModifiers: [] }];
    await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    const table = useStore.getState().tables.find(t => t.id === 'tbl-1');
    expect(table?.status).toBe('occupied');
  });
});

// ── Stock conflict / oversell prevention ──────────────────────────────────────

describe('stock conflict prevention', () => {
  beforeEach(() => { freshStore(); });

  it('prevents two sessions from both buying the last unit', () => {
    // item-d has stock = 1
    const cart1: CartItem[] = [{ menuItemId: 'item-d', quantity: 1, selectedModifiers: [] }];
    const cart2: CartItem[] = [{ menuItemId: 'item-d', quantity: 1, selectedModifiers: [] }];

    // Session 1 reserves
    const reserved1 = useStore.getState().createReservation('sess-A', cart1);
    expect(reserved1).toBe(true);

    // Session 2 tries to reserve — stock already reserved
    const reserved2 = useStore.getState().createReservation('sess-B', cart2);
    expect(reserved2).toBe(false);
  });

  it('session 1 checkout succeeds; session 2 checkout then fails', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-d', quantity: 1, selectedModifiers: [] }];

    // Session 1 checks out
    const r1 = await useStore.getState().checkout({ sessionId: 'sess-A', tableId: 'tbl-1', paymentMethod: 'card', cart });
    expect(r1.success).toBe(true);

    // Session 2 tries to checkout — stock now 0
    const r2 = await useStore.getState().checkout({ sessionId: 'sess-B', tableId: 'tbl-1', paymentMethod: 'card', cart });
    expect(r2.success).toBe(false);
  });

  it('releasing a reservation frees stock for another session', () => {
    const cart: CartItem[] = [{ menuItemId: 'item-d', quantity: 1, selectedModifiers: [] }];
    useStore.getState().createReservation('sess-A', cart);
    useStore.getState().releaseReservation('sess-A');
    const reserved2 = useStore.getState().createReservation('sess-B', cart);
    expect(reserved2).toBe(true);
  });
});

// ── cancelOrder restores stock ────────────────────────────────────────────────

describe('cancelOrder', () => {
  beforeEach(() => { freshStore(); });

  it('restores stock when order is cancelled', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 2, selectedModifiers: [] }];
    const result = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    if (!result.success) return;

    const stockAfterOrder = useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock;
    expect(stockAfterOrder).toBe(3);

    useStore.getState().cancelOrder(result.order.id);
    const stockAfterCancel = useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock;
    expect(stockAfterCancel).toBe(5); // fully restored
  });

  it('sets order status to cancelled', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 1, selectedModifiers: [] }];
    const result = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    if (!result.success) return;
    useStore.getState().cancelOrder(result.order.id);
    const order = useStore.getState().orders.find(o => o.id === result.order.id);
    expect(order?.status).toBe('cancelled');
  });
});

// ── advanceOrderStatus ────────────────────────────────────────────────────────

describe('advanceOrderStatus', () => {
  beforeEach(() => { freshStore(); });

  it('advances paid → preparing → ready → completed', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 1, selectedModifiers: [] }];
    const result = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    if (!result.success) return;
    const id = result.order.id;

    useStore.getState().advanceOrderStatus(id);
    expect(useStore.getState().orders.find(o => o.id === id)?.status).toBe('preparing');

    useStore.getState().advanceOrderStatus(id);
    expect(useStore.getState().orders.find(o => o.id === id)?.status).toBe('ready');

    useStore.getState().advanceOrderStatus(id);
    expect(useStore.getState().orders.find(o => o.id === id)?.status).toBe('completed');
  });

  it('does nothing when order is already completed', async () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 1, selectedModifiers: [] }];
    const result = await useStore.getState().checkout({ sessionId: 'sess-1', tableId: 'tbl-1', paymentMethod: 'card', cart });
    if (!result.success) return;
    const id = result.order.id;
    // Advance to completed
    ['preparing', 'ready', 'completed'].forEach(() => useStore.getState().advanceOrderStatus(id));
    useStore.getState().advanceOrderStatus(id); // extra call — should be no-op
    expect(useStore.getState().orders.find(o => o.id === id)?.status).toBe('completed');
  });
});

// ── Menu management ───────────────────────────────────────────────────────────

describe('menu management', () => {
  beforeEach(() => { freshStore(); });

  it('addMenuItem creates item with correct fields', () => {
    const count = useStore.getState().menuItems.length;
    const item = useStore.getState().addMenuItem({
      name: 'Bruschetta', description: 'Toast', category: 'Food', price: 7.50, prepTime: 5,
      stock: 10, maxStock: 20, status: 'active', icon: '🍞', imageUrl: '', thumbnailUrl: '',
      tags: ['vegetarian'], modifiers: [],
    });
    expect(useStore.getState().menuItems).toHaveLength(count + 1);
    expect(item.id).toBeTruthy();
    expect(item.salesCount).toBe(0);
  });

  it('updateMenuItem changes fields', () => {
    useStore.getState().updateMenuItem('item-a', { price: 15.00, name: 'Premium Pizza' });
    const item = useStore.getState().menuItems.find(m => m.id === 'item-a');
    expect(item?.price).toBe(15.00);
    expect(item?.name).toBe('Premium Pizza');
  });

  it('deleteMenuItem archives the item (soft delete)', () => {
    useStore.getState().deleteMenuItem('item-a');
    const item = useStore.getState().menuItems.find(m => m.id === 'item-a');
    expect(item?.status).toBe('archived');
  });

  it('setMenuItemStatus changes availability', () => {
    useStore.getState().setMenuItemStatus('item-a', 'disabled');
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.status).toBe('disabled');
    useStore.getState().setMenuItemStatus('item-a', 'active');
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.status).toBe('active');
  });
});

// ── Stock operations ──────────────────────────────────────────────────────────

describe('stock operations', () => {
  beforeEach(() => { freshStore(); });

  it('adjustStock increases and decreases stock', () => {
    useStore.getState().adjustStock('item-a', 3);
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock).toBe(8);
    useStore.getState().adjustStock('item-a', -2);
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock).toBe(6);
  });

  it('adjustStock never goes below 0', () => {
    useStore.getState().adjustStock('item-a', -100);
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock).toBe(0);
  });

  it('restockItem sets stock to maxStock', () => {
    useStore.getState().adjustStock('item-a', -3);
    useStore.getState().restockItem('item-a');
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock).toBe(20);
  });

  it('setStock sets an exact value', () => {
    useStore.getState().setStock('item-a', 7);
    expect(useStore.getState().menuItems.find(m => m.id === 'item-a')?.stock).toBe(7);
  });
});

// ── Table management ──────────────────────────────────────────────────────────

describe('table management', () => {
  beforeEach(() => { freshStore(); });

  it('addTable creates table', () => {
    const table = useStore.getState().addTable({ number: 10, name: 'Rooftop', capacity: 6 });
    expect(table.id).toBeTruthy();
    expect(useStore.getState().tables.some(t => t.id === table.id)).toBe(true);
  });

  it('updateTable changes name and capacity', () => {
    useStore.getState().updateTable('tbl-1', { name: 'VIP Table', capacity: 8 });
    const t = useStore.getState().tables.find(t => t.id === 'tbl-1');
    expect(t?.name).toBe('VIP Table');
    expect(t?.capacity).toBe(8);
  });

  it('deleteTable removes table', () => {
    const table = useStore.getState().addTable({ number: 99, name: 'Test', capacity: 2 });
    useStore.getState().deleteTable(table.id);
    expect(useStore.getState().tables.some(t => t.id === table.id)).toBe(false);
  });

  it('setTableStatus changes status', () => {
    useStore.getState().setTableStatus('tbl-1', 'occupied');
    expect(useStore.getState().tables.find(t => t.id === 'tbl-1')?.status).toBe('occupied');
  });
});

// ── Settings persistence ──────────────────────────────────────────────────────

describe('settings', () => {
  beforeEach(() => { freshStore(); });

  it('updateSettings persists changes', () => {
    useStore.getState().updateSettings({ businessName: 'New Name', taxRate: 20 });
    expect(useStore.getState().settings.businessName).toBe('New Name');
    expect(useStore.getState().settings.taxRate).toBe(20);
  });

  it('partial update does not overwrite other fields', () => {
    useStore.getState().updateSettings({ businessName: 'Updated' });
    expect(useStore.getState().settings.currency).toBe('EUR');
  });
});

// ── getAvailableStock (reservation-aware) ─────────────────────────────────────

describe('getAvailableStock', () => {
  beforeEach(() => { freshStore(); });

  it('returns full stock when no reservations', () => {
    expect(useStore.getState().getAvailableStock('item-a')).toBe(5);
  });

  it('returns reduced stock when reservation is active', () => {
    const cart: CartItem[] = [{ menuItemId: 'item-a', quantity: 3, selectedModifiers: [] }];
    useStore.getState().createReservation('sess-X', cart);
    expect(useStore.getState().getAvailableStock('item-a')).toBe(2); // 5 - 3
  });

  it('returns Infinity for unlimited-stock items', () => {
    // Add unlimited item
    useStore.getState().addMenuItem({
      name: 'Special', description: '', category: 'Food', price: 5, prepTime: 5,
      stock: null, maxStock: null, status: 'active', icon: '✨', imageUrl: '', thumbnailUrl: '',
      tags: [], modifiers: [],
    });
    const item = useStore.getState().menuItems.find(m => m.name === 'Special');
    expect(useStore.getState().getAvailableStock(item!.id)).toBe(Infinity);
  });
});

// ── Workspace isolation ───────────────────────────────────────────────────────

describe('workspace isolation', () => {
  beforeEach(() => { freshStore(); });

  it('demo user gets full seed data on login', async () => {
    await useStore.getState().login('demo@smartline.io', 'demo1234');
    const state = useStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.menuItems).toHaveLength(SEED_MENU_ITEMS.length);
    expect(state.tables).toHaveLength(SEED_TABLES.length);
    expect(state.settings.businessName).toBe('The Urban Kitchen');
  });

  it('new user signup gets clean starter workspace with their business name', async () => {
    await useStore.getState().signup({
      email: 'alice@example.com',
      password: 'pass1234',
      name: 'Alice Smith',
      businessName: "Alice's Bistro",
    });
    const state = useStore.getState();
    expect(state.isAuthenticated).toBe(true);
    // New accounts start with a blank menu
    expect(state.menuItems).toHaveLength(0);
    expect(state.settings.businessName).toBe("Alice's Bistro");
    expect(state.orders).toHaveLength(0);
    expect(state.receipts).toHaveLength(0);
  });

  it('new user starts with an empty menu (blank canvas)', async () => {
    await useStore.getState().signup({
      email: 'bob@example.com', password: 'pass1234',
      name: 'Bob', businessName: "Bob's Place",
    });
    expect(useStore.getState().menuItems).toHaveLength(0);
  });

  it('two accounts do not share menu items, orders, or settings', async () => {
    // Account A: sign up and add a custom item + place an order
    await useStore.getState().signup({
      email: 'accounta@example.com', password: 'pass1234',
      name: 'User A', businessName: 'Restaurant A',
    });
    useStore.getState().addMenuItem({
      name: 'Secret Dish A', description: 'Only A has this', category: 'Specials',
      price: 99.00, prepTime: 5, stock: null, maxStock: null, status: 'active',
      icon: '⭐', imageUrl: '', thumbnailUrl: '', tags: [], modifiers: [],
    });
    const tableA = useStore.getState().tables[0];
    const secretItem = useStore.getState().menuItems.find(m => m.name === 'Secret Dish A')!;
    await useStore.getState().checkout({
      sessionId: 'sess-a', tableId: tableA.id, paymentMethod: 'card',
      cart: [{ menuItemId: secretItem.id, quantity: 1, selectedModifiers: [] }],
    });
    expect(useStore.getState().orders).toHaveLength(1);

    // Account A logs out
    await useStore.getState().logout();
    expect(useStore.getState().menuItems).toHaveLength(0);
    expect(useStore.getState().orders).toHaveLength(0);

    // Account B signs up — should see a completely clean workspace
    await useStore.getState().signup({
      email: 'accountb@example.com', password: 'pass5678',
      name: 'User B', businessName: 'Restaurant B',
    });
    const stateB = useStore.getState();
    expect(stateB.settings.businessName).toBe('Restaurant B');
    expect(stateB.orders).toHaveLength(0);
    expect(stateB.menuItems.every(i => i.name !== 'Secret Dish A')).toBe(true);
  });

  it('login after logout restores previously saved workspace', async () => {
    // Sign up and customise settings
    await useStore.getState().signup({
      email: 'returning@example.com', password: 'pass1234',
      name: 'Returning User', businessName: 'My Place',
    });
    useStore.getState().updateSettings({ businessName: 'My Updated Place', taxRate: 15 });

    // Logout — workspace is saved in localStorage, memory is cleared
    await useStore.getState().logout();
    expect(useStore.getState().settings.businessName).not.toBe('My Updated Place');

    // Log back in — should restore the updated settings
    const result = await useStore.getState().login('returning@example.com', 'pass1234');
    expect(result.success).toBe(true);
    expect(useStore.getState().settings.businessName).toBe('My Updated Place');
    expect(useStore.getState().settings.taxRate).toBe(15);
  });

  it('logout clears workspace data from memory', async () => {
    await useStore.getState().login('demo@smartline.io', 'demo1234');
    expect(useStore.getState().menuItems.length).toBeGreaterThan(0);
    expect(useStore.getState().tables.length).toBeGreaterThan(0);

    await useStore.getState().logout();
    expect(useStore.getState().menuItems).toHaveLength(0);
    expect(useStore.getState().tables).toHaveLength(0);
    expect(useStore.getState().user).toBeNull();
    expect(useStore.getState().isAuthenticated).toBe(false);
  });

  it('demo user account rejects duplicate email on signup', async () => {
    const result = await useStore.getState().signup({
      email: 'demo@smartline.io', password: 'anything',
      name: 'Impostor', businessName: 'Fake Kitchen',
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });
});
