/** Checkout, reservations and order status operations (shared domain rules / server RPCs). */
import { toast } from 'sonner';
import type { TableStatus, Order, OrderStatus, OrderItem, Receipt, StockReservation, CheckoutPayload, CheckoutResult, CartValidationIssue } from '../../domain/types';
import { advance } from '../../domain/orderMachine';
import { evaluateCheckout, groupModifierSelections } from '../../domain/ordering/cart';
import { applyTransition } from '../../domain/ordering/orderOperations';
import * as workspaceService from '../../services/workspaceService';
import * as bridge from '../bridge';
import { genId, now, RESERVATION_TTL_MS, usesSupabasePersistence, persistLocal, errorMessage } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createOrderSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'transitionOrder' | 'advanceOrderStatus' | 'cancelOrder' | 'refundOrder' | 'adjustPrepTime' | 'validateCart' | 'createReservation' | 'releaseReservation' | 'checkout' | 'getAvailableStock'> => ({
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
    persistLocal(get);
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
    persistLocal(get);
    const order = get().orders.find(o => o.id === orderId);
    if (usesSupabasePersistence() && get().user?.id && order) {
      bridge.persistOrderUpdate(orderId, { prepTimeAdjustment: order.prepTimeAdjustment }).catch(() =>
        toast.error('Failed to sync prep time.'));
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
    persistLocal(get);

    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewReservation(reservation, user.id).catch(() => {/* best-effort */});
    }
    return true;
  },

  releaseReservation(sessionId) {
    set(s => ({ reservations: s.reservations.filter(r => r.sessionId !== sessionId) }));
    persistLocal(get);
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
    return localCheckout({ ...payload, clientOrderId }, get, set);
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
});
// ─── Local checkout (no Supabase) ────────────────────────────────────────────

function localCheckout(
  payload: CheckoutPayload & { clientOrderId: string },
  get: StoreGet,
  set: StoreSet,
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
  persistLocal(get);
  return { success: true, order, receipt };
}


function channelOfTable(tableId: string): Order['orderChannel'] {
  return tableId === 'takeaway' || tableId === 'delivery' ? tableId : 'dine-in';
}

