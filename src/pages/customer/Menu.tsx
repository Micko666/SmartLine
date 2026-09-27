import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Plus, Minus, X, ChefHat, Clock, Search, AlertTriangle, ClipboardList, Package, Bike } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { CartItem, CartItemModifier, MenuItem, PaymentMethod } from '@/domain/types';
import { getDeviceId, loadSession, saveSession, type SessionCartItem } from '@/lib/customerSession';
import { isSupabaseEnabled } from '@/store/flags';
import { useMenuSubscription } from '@/lib/supabase/realtime/useMenuSubscription';
import { fetchRestaurantByToken } from '@/lib/supabase/queries/public';
import { orderingSlots, orderingOpen } from '@/domain/ordering/scheduling';
import { formatScheduled } from '@/domain/time/restaurantTime';
import { loadDeliveryAddress, saveDeliveryAddress } from '@/lib/orderContext';
import { SESSION_ID, OrderMode, MODE_META, DIETARY_EMOJI } from './menu/shared';
import StockBadge from './menu/StockBadge';
import ModeSelectorScreen from './menu/ModeSelectorScreen';
import ModeUnavailableScreen from './menu/ModeUnavailableScreen';
import SchedulingStep from './menu/SchedulingStep';
import ItemSheet from './menu/ItemSheet';
import CartSheet from './menu/CartSheet';
import PaymentSheet from './menu/PaymentSheet';
import SessionOrdersSheet from './menu/SessionOrdersSheet';

// ─── Main component ───────────────────────────────────────────────────────────
export default function CustomerMenu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // URL params — ?t=tableId for dine-in, ?mode=takeaway|delivery for off-premise
  const tableParam      = searchParams.get('t') ?? '';
  const modeParam       = searchParams.get('mode') ?? '';
  const restaurantToken = searchParams.get('r') ?? '';
  // Scheduling params set by OrderPortal before navigating here
  const scheduledDate   = searchParams.get('date') ?? '';
  const scheduledTime   = searchParams.get('time') ?? '';
  const scheduledAddr = loadDeliveryAddress(restaurantToken);

  // Derive order mode
  const orderMode: OrderMode =
    modeParam === 'takeaway' ? 'takeaway' :
    modeParam === 'delivery' ? 'delivery' : 'dine-in';

  // The tableId sent to checkout — real UUID for dine-in, keyword for off-premise
  const effectiveTableId = orderMode === 'dine-in'
    ? (tableParam || 'walk-in')
    : MODE_META[orderMode].tableId;

  const {
    menuItems, tables, settings, orders,
    validateCart, createReservation, releaseReservation, checkout, getAvailableStock,
  } = useStore(useShallow(s => ({
    menuItems:          s.menuItems,
    categories:         s.categories,
    tables:             s.tables,
    settings:           s.settings,
    orders:             s.orders,
    validateCart:       s.validateCart,
    createReservation:  s.createReservation,
    releaseReservation: s.releaseReservation,
    checkout:           s.checkout,
    getAvailableStock:  s.getAvailableStock,
  })));

  const table     = tables.find(t => t.id === tableParam);
  const sym       = settings.currencySymbol;
  const threshold = settings.lowStockThreshold;

  // ── Supabase bootstrap ─────────────────────────────────────────────────────
  const [menuError, setMenuError] = useState(false);
  const [menuLoading, setMenuLoading] = useState(isSupabaseEnabled() && !!restaurantToken);

  useEffect(() => {
    if (!isSupabaseEnabled() || !restaurantToken) return;
    fetchRestaurantByToken(restaurantToken).then(data => {
      if (data) {
        useStore.getState().hydrateCustomerContext(data);
      }
      setMenuError(!data);
      setMenuLoading(false);
    }).catch(() => { setMenuError(true); setMenuLoading(false); });
  }, [restaurantToken]);

  useMenuSubscription(restaurantToken);

  const deviceId = useMemo(() => getDeviceId(), []);

  // ── Cart (restored from persisted session) ─────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (!restaurantToken) return [];
    const session = loadSession(restaurantToken);
    if (!session || session.tableId !== effectiveTableId) return [];
    return session.cart.map(si => ({
      menuItemId: si.menuItemId,
      quantity: si.quantity,
      selectedModifiers: si.modifiers,
    }));
  });

  const [placedOrderIds, setPlacedOrderIds] = useState<string[]>(() => {
    if (!restaurantToken) return [];
    const session = loadSession(restaurantToken);
    if (!session || session.tableId !== effectiveTableId) return [];
    return session.placedOrderIds ?? [];
  });

  // ── UI state ───────────────────────────────────────────────────────────────
  const [activeCat,         setActiveCat]         = useState('All');
  const [search,            setSearch]             = useState('');
  const [showCart,          setShowCart]           = useState(false);
  const [showPayment,       setShowPayment]        = useState(false);
  const [showSessionOrders, setShowSessionOrders]  = useState(false);
  const [selectedItem,      setSelectedItem]       = useState<MenuItem | null>(null);
  const [notes,             setNotes]              = useState('');
  const [checkoutLoading,   setCheckoutLoading]    = useState(false);
  const [cartIssues,        setCartIssues]         = useState<string[]>([]);

  const submitting = useRef(false);
  const requestId = useRef(crypto.randomUUID());

  // Customer info — collected at payment for takeaway / delivery.
  // deliveryAddress is pre-filled from the URL ?addr= param set by OrderPortal.
  const [customerName,     setCustomerName]     = useState('');
  const [customerPhone,    setCustomerPhone]    = useState('');
  const [deliveryAddress,  setDeliveryAddress]  = useState(scheduledAddr);

  // ── Session persistence ────────────────────────────────────────────────────
  useEffect(() => {
    if (!restaurantToken) return;
    const enrichedCart: SessionCartItem[] = cart.map(ci => {
      const item = menuItems.find(m => m.id === ci.menuItemId);
      const modExtra = ci.selectedModifiers.reduce((s, sel) => {
        const mod = item?.modifiers.find(m => m.id === sel.modifierId);
        const opt = mod?.options.find(o => o.id === sel.optionId);
        return s + (opt?.priceAdjustment ?? 0);
      }, 0);
      const basePrice = item?.price ?? 0;
      return {
        menuItemId:   ci.menuItemId,
        menuItemName: item?.name ?? ci.menuItemId,
        menuItemIcon: item?.icon ?? '🍽️',
        basePrice,
        quantity:     ci.quantity,
        modifiers:    ci.selectedModifiers,
        lineTotal:    (basePrice + modExtra) * ci.quantity,
      };
    });
    saveSession(restaurantToken, {
      deviceId,
      tableId: effectiveTableId,
      cart: enrichedCart,
      placedOrderIds,
      updatedAt: Date.now(),
    });
  }, [cart, placedOrderIds, restaurantToken, deviceId, effectiveTableId, menuItems]);

  useEffect(() => { return () => releaseReservation(SESSION_ID); }, [releaseReservation]);

  const sessionOrders = orders.filter(o => placedOrderIds.includes(o.id));

  // ── Menu items ─────────────────────────────────────────────────────────────
  const visibleItems = menuItems.filter(item => {
    if (item.status !== 'active') return false;
    if (item.stock !== null && item.stock === 0 && settings.zeroStockBehavior === 'hide') return false;
    return true;
  });

  const filtered = visibleItems
    .filter(i => activeCat === 'All' || i.category === activeCat)
    .filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const availableCategories = [...new Set(visibleItems.map(i => i.category).filter(Boolean))];

  // ── Cart calculations ──────────────────────────────────────────────────────
  const cartTotal = cart.reduce((sum, ci) => {
    const item = menuItems.find(m => m.id === ci.menuItemId);
    if (!item) return sum;
    const modExtra = ci.selectedModifiers.reduce((s, sel) => {
      const mod = item.modifiers.find(m => m.id === sel.modifierId);
      const opt = mod?.options.find(o => o.id === sel.optionId);
      return s + (opt?.priceAdjustment ?? 0);
    }, 0);
    return sum + (item.price + modExtra) * ci.quantity;
  }, 0);

  const taxAmount        = settings.taxDisplay === 'exclusive' ? cartTotal * (settings.taxRate / 100) : 0;
  const cartTotalWithTax = cartTotal + taxAmount;
  const totalItems       = cart.reduce((s, ci) => s + ci.quantity, 0);

  const estimatedWait = cart.length === 0 ? 0 : (() => {
    const maxPrep = Math.max(...cart.map(ci => {
      const item = menuItems.find(m => m.id === ci.menuItemId);
      return item ? item.prepTime : 10;
    }));
    return maxPrep + Math.max(0, cart.length - 1) * 2;
  })();

  // Whether customer info is sufficiently filled for non-dine-in checkout
  const customerInfoValid =
    orderMode === 'dine-in' ||
    (customerName.trim().length > 0 &&
     customerPhone.trim().length > 0 &&
     (orderMode !== 'delivery' || deliveryAddress.trim().length > 0));

  // ── Cart actions ───────────────────────────────────────────────────────────
  const addToCart = (item: MenuItem, modifiers: CartItemModifier[] = []) => {
    const avail  = getAvailableStock(item.id);
    const inCart = cart.filter(c => c.menuItemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
    if (item.stock !== null && inCart >= avail) { toast.error(`Only ${avail} available`); return; }
    setCart(prev => {
      const existing = prev.find(c => c.menuItemId === item.id && JSON.stringify(c.selectedModifiers) === JSON.stringify(modifiers));
      if (existing) return prev.map(c => c === existing ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { menuItemId: item.id, quantity: 1, selectedModifiers: modifiers }];
    });
  };

  const updateQty = (menuItemId: string, delta: number) => {
    setCart(prev =>
      prev.map(c => c.menuItemId === menuItemId ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c)
          .filter(c => c.quantity > 0),
    );
  };

  const removeFromCart = (menuItemId: string) => setCart(prev => prev.filter(c => c.menuItemId !== menuItemId));

  // ── Cart revalidation ──────────────────────────────────────────────────────
  const revalidateCart = useCallback(() => {
    if (cart.length === 0) return true;
    const result = validateCart(cart);
    if (!result.valid) {
      const issues = result.issues.map(i => i.menuItemName);
      setCartIssues(issues);
      const removedIds = result.issues
        .filter(i => i.reason === 'out_of_stock' || i.reason === 'item_not_found' || i.reason === 'item_disabled')
        .map(i => i.menuItemId);
      const clampedIds = result.issues.filter(i => i.reason === 'insufficient_stock');
      setCart(prev => {
        let updated = prev.filter(c => !removedIds.includes(c.menuItemId));
        updated = updated.map(c => {
          const issue = clampedIds.find(i => i.menuItemId === c.menuItemId);
          return issue ? { ...c, quantity: issue.available } : c;
        }).filter(c => c.quantity > 0);
        return updated;
      });
      return false;
    }
    setCartIssues([]);
    return true;
  }, [cart, validateCart]);

  const handleOpenCart = () => { revalidateCart(); setShowCart(true); };

  const handleProceedToPayment = () => {
    if (!revalidateCart()) { toast.error('Some items were updated. Please review your cart.'); return; }
    const reserved = createReservation(SESSION_ID, cart);
    if (!reserved) { revalidateCart(); toast.error('Some items ran out of stock. Cart has been updated.'); return; }
    setShowCart(false);
    setShowPayment(true);
    setCartIssues([]);
  };

  // ── Submit checkout ────────────────────────────────────────────────────────
  const handlePayment = async (method: PaymentMethod) => {
    if (submitting.current) return;
    if (orderMode !== 'dine-in' && !orderingSlots(scheduledDate, settings.businessHours, settings.timezone).includes(scheduledTime)) {
      toast.error('Please choose a new available time.');
      const next = new URLSearchParams(searchParams); next.delete('time'); setSearchParams(next); return;
    }
    submitting.current = true;
    setCheckoutLoading(true);

    const result = await checkout({
      sessionId:       SESSION_ID,
      tableId:         effectiveTableId,
      paymentMethod:   method,
      cart,
      notes: notes.trim() || undefined,
      clientOrderId: requestId.current,
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      deliveryAddress: orderMode === 'delivery' ? deliveryAddress.trim() : '',
      scheduledFor:    (orderMode !== 'dine-in' && scheduledDate && scheduledTime)
                         ? `${scheduledDate} ${scheduledTime}`
                         : undefined,
      restaurantToken: restaurantToken || undefined,
    });

    setCheckoutLoading(false);
    submitting.current = false;

    if (result.success === true) {
      const updatedOrderIds = [...placedOrderIds, result.order.id];
      if (restaurantToken) {
        saveSession(restaurantToken, {
          deviceId,
          tableId: effectiveTableId,
          cart: [],
          placedOrderIds: updatedOrderIds,
          updatedAt: Date.now(),
        });
      }
      setPlacedOrderIds(updatedOrderIds);
      setShowPayment(false);
      setCart([]);
      requestId.current = crypto.randomUUID();
      setCartIssues([]);
      // Build receipt URL — carry all scheduling params so the receipt page
      // can reconstruct a correct "Order More" link and show the right copy.
      const params = new URLSearchParams();
      if (restaurantToken) params.set('r', restaurantToken);
      if (orderMode === 'dine-in' && tableParam) {
        params.set('t', tableParam);
      } else if (orderMode !== 'dine-in') {
        params.set('mode', orderMode);
        if (scheduledDate) params.set('date', scheduledDate);
        if (scheduledTime) params.set('time', scheduledTime);
        if (orderMode === 'delivery') saveDeliveryAddress(restaurantToken, deliveryAddress.trim());
      }
      navigate(`/receipt/${result.receipt.id}?${params.toString()}`);
    } else {
      const issues = result.unavailableItems;
      revalidateCart();
      setCartIssues(issues);
      if (issues.length > 0) {
        toast.error(`Some items are no longer available: ${issues.join(', ')}`);
      } else {
        toast.error(result.error ?? 'Order failed. Please try again.');
      }
      setShowPayment(false);
      setShowCart(true);
    }
  };

  // ── Mode selector — shown when customer arrives via the generic portal link
  //    (no table QR and no explicit ?mode=). They pick their channel here.
  if (!menuLoading && (menuError || (restaurantToken && settings.restaurantToken !== restaurantToken))) return <div role="alert" className="p-8 text-center">Menu unavailable. Please check the restaurant link and reload.</div>;
  const open = orderingOpen(settings.businessHours, settings.timezone);
  if (!menuLoading && (settings.orderingPaused || open.open === false)) return <div className="p-8 text-center"><h1>{settings.businessName}</h1><p>{settings.orderingPaused ? settings.orderingPausedMessage || 'Orders paused' : open.open === false ? open.reason : ''}</p></div>;
  if (!menuLoading && orderMode === 'dine-in' && (modeParam || tableParam) && !table) return <div className="p-8 text-center">Please scan the QR code on your table to dine in.</div>;
  const needsModeSelection = !menuLoading && !tableParam && !modeParam;
  if (needsModeSelection) {
    const selectMode = (mode: OrderMode) => {
      if (mode === 'dine-in') {
        // Dine-in needs the table picker — send to OrderPortal which has it
        if (restaurantToken) navigate(`/order/${restaurantToken}`);
        return;
      }
      // Takeaway / delivery — set mode param; SchedulingStep handles the rest
      const next = new URLSearchParams(searchParams);
      next.set('mode', mode);
      setSearchParams(next, { replace: true });
    };
    return (
      <ModeSelectorScreen
        businessName={settings.businessName}
        logoUrl={settings.logoUrl}
        openingHours={settings.openingHours}
        takeawayEnabled={settings.takeawayEnabled}
        deliveryEnabled={settings.deliveryEnabled}
        orderingPaused={settings.orderingPaused}
        orderingPausedMessage={settings.orderingPausedMessage}
        onSelect={selectMode}
      />
    );
  }

  // ── Mode unavailable (arrived via direct link with disabled mode) ───────────
  if (!menuLoading && orderMode === 'takeaway' && !settings.takeawayEnabled) {
    return <ModeUnavailableScreen mode="takeaway" businessName={settings.businessName} logoUrl={settings.logoUrl} />;
  }
  if (!menuLoading && orderMode === 'delivery' && !settings.deliveryEnabled) {
    return <ModeUnavailableScreen mode="delivery" businessName={settings.businessName} logoUrl={settings.logoUrl} />;
  }

  // ── Needs scheduling — takeaway/delivery arrived without date+time params ──
  // This handles the edge case of someone visiting /menu?mode=takeaway&r=… directly.
  // OrderPortal always sets these params; this is just a safety fallback.
  const needsScheduling = !menuLoading &&
    (orderMode === 'takeaway' || orderMode === 'delivery') &&
    (!scheduledDate || !scheduledTime || !orderingSlots(scheduledDate, settings.businessHours, settings.timezone).includes(scheduledTime));

  if (needsScheduling) {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-xl border-b border-border">
          <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
              {settings.logoUrl
                ? <img src={settings.logoUrl} alt="logo" className="w-full h-full rounded-xl object-cover" />
                : <ChefHat className="w-4 h-4 text-primary-foreground" />}
            </div>
            <div>
              <p className="font-display font-bold text-sm">{settings.businessName}</p>
              <p className="text-[10px] text-muted-foreground">
                {orderMode === 'takeaway' ? 'Schedule your pickup' : 'Schedule your delivery'}
              </p>
            </div>
          </div>
        </header>
        <SchedulingStep
          settings={settings}
          orderMode={orderMode as 'takeaway' | 'delivery'}
          onConfirm={(date, time, addr) => {
            if (addr) setDeliveryAddress(addr);
            const next = new URLSearchParams(searchParams);
            next.set('date', date);
            next.set('time', time);
            if (addr) saveDeliveryAddress(restaurantToken, addr);
            next.delete('addr');
            setSearchParams(next, { replace: true });
          }}
        />
      </div>
    );
  }

  // ── Header subtitle ────────────────────────────────────────────────────────
  const headerSubtitle =
    orderMode === 'takeaway' ? MODE_META.takeaway.subtitle :
    orderMode === 'delivery' ? MODE_META.delivery.subtitle :
    [table?.name, settings.openingHours].filter(Boolean).join(' · ');

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-xl border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="logo" className="w-full h-full rounded-xl object-cover" />
            ) : (
              <ChefHat className="w-4 h-4 text-primary-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-sm truncate">{settings.businessName}</p>
            {headerSubtitle && (
              <p className="text-[10px] text-muted-foreground truncate">{headerSubtitle}</p>
            )}
          </div>

          {/* Mode badge — shows scheduled time when available */}
          {orderMode !== 'dine-in' && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-semibold shrink-0">
              {orderMode === 'takeaway' ? <Package className="w-3 h-3" /> : <Bike className="w-3 h-3" />}
              {scheduledDate && scheduledTime
                ? formatScheduled(scheduledDate, scheduledTime, settings.timezone)
                : MODE_META[orderMode].label}
            </span>
          )}

          {/* Previous orders badge */}
          {restaurantToken && placedOrderIds.length > 0 && (
            <button
              onClick={() => setShowSessionOrders(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-primary/10 text-primary text-xs font-semibold shrink-0 hover:bg-primary/20 transition-colors"
              title="Your orders this visit"
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>{placedOrderIds.length}</span>
            </button>
          )}

          {/* Dine-in table not found warning */}
          {orderMode === 'dine-in' && tableParam && !table && (
            <span className="flex items-center gap-1 text-[10px] text-warning shrink-0">
              <AlertTriangle className="w-3 h-3" /> Table not found
            </span>
          )}
        </div>

        {/* Search */}
        <div className="max-w-lg mx-auto px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search the menu…"
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
            />
          </div>
        </div>

        {/* Categories */}
        <div className="max-w-lg mx-auto flex gap-2 overflow-x-auto pb-3 px-4 no-scrollbar">
          {['All', ...availableCategories].map(cat => (
            <button
              key={cat} onClick={() => setActiveCat(cat)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0 ${activeCat === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </header>

      {/* Cart issues banner */}
      <AnimatePresence>
        {cartIssues.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="max-w-lg mx-auto px-4 pt-3"
          >
            <div className="flex items-start gap-2 p-3 rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Cart updated</p>
                <p className="text-xs mt-0.5">Unavailable: {cartIssues.join(', ')}</p>
              </div>
              <button onClick={() => setCartIssues([])} className="ml-auto shrink-0"><X className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Menu items */}
      <div className="max-w-lg mx-auto px-4 py-4 space-y-3">
        {menuLoading ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No items found.</p>
          </div>
        ) : filtered.map(item => {
          const avail  = getAvailableStock(item.id);
          const isOut  = item.stock !== null && avail <= 0;
          const inCart = cart.find(c => c.menuItemId === item.id)?.quantity ?? 0;

          return (
            <motion.div
              key={item.id} layout
              className={`glass-card overflow-hidden transition-opacity ${isOut ? 'opacity-50' : 'cursor-pointer active:scale-[0.98] transition-transform'}`}
              onClick={() => !isOut && setSelectedItem(item)}
            >
              <div className="flex gap-3 p-4">
                <div className="shrink-0 w-20 h-20 rounded-xl overflow-hidden bg-muted flex items-center justify-center">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-4xl">{item.icon}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm leading-tight">{item.name}</h3>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {item.tags.map(t => <span key={t} className="text-[10px] text-primary font-medium">{t}</span>)}
                      </div>
                    </div>
                    <StockBadge stock={item.stock} threshold={threshold} />
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.description}</p>

                  {((item.dietaryTags?.length ?? 0) > 0 || (item.allergens?.length ?? 0) > 0 || item.calories != null) && (
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      {item.calories != null && (
                        <span className="text-[10px] text-muted-foreground font-medium">{item.calories} kcal</span>
                      )}
                      {item.dietaryTags?.slice(0, 3).map(t => (
                        <span key={t} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-700">{DIETARY_EMOJI[t] ?? ''} {t}</span>
                      ))}
                      {(item.allergens?.length ?? 0) > 0 && (
                        <span className="text-[10px] font-semibold text-amber-600">⚠ allergens</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2">
                    <div>
                      <span className="font-bold text-base">{sym}{item.price.toFixed(2)}</span>
                      <span className="text-[10px] text-muted-foreground ml-2 flex items-center gap-0.5 inline-flex">
                        <Clock className="w-2.5 h-2.5" /> {item.prepTime}min
                      </span>
                    </div>
                    {!isOut && (
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        {inCart > 0 ? (
                          <div className="flex items-center gap-2 bg-primary/10 rounded-full px-2 py-1">
                            <button onClick={() => updateQty(item.id, -1)} className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center hover:bg-primary/30">
                              <Minus className="w-3 h-3 text-primary" />
                            </button>
                            <span className="text-sm font-bold text-primary w-4 text-center">{inCart}</span>
                            <button
                              onClick={() => {
                                if (item.stock !== null && inCart >= avail) { toast.error(`Only ${avail} available`); return; }
                                addToCart(item);
                              }}
                              className="w-6 h-6 rounded-full bg-primary flex items-center justify-center hover:opacity-90"
                            >
                              <Plus className="w-3 h-3 text-primary-foreground" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); addToCart(item); toast.success(`${item.name} added`, { position: 'top-center' }); }}
                            className="w-9 h-9 rounded-full bg-primary flex items-center justify-center hover:opacity-90 transition-opacity"
                          >
                            <Plus className="w-4 h-4 text-primary-foreground" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Sticky cart button */}
      <AnimatePresence>
        {totalItems > 0 && (
          <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }}
            className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-card/90 backdrop-blur-xl border-t border-border"
          >
            <div className="max-w-lg mx-auto">
              <button
                onClick={handleOpenCart}
                className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center px-5 gap-3 hover:opacity-90 transition-opacity"
              >
                <div className="w-8 h-8 rounded-xl bg-primary-foreground/20 flex items-center justify-center text-xs font-bold">{totalItems}</div>
                <span className="flex-1 text-left">View Cart</span>
                <span className="font-bold text-base">{sym}{cartTotalWithTax.toFixed(2)}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item detail sheet */}
      <AnimatePresence>
        {selectedItem && (
          <ItemSheet
            item={selectedItem}
            sym={sym}
            onAdd={(modifiers) => { addToCart(selectedItem, modifiers); toast.success(`${selectedItem.name} added`, { position: 'top-center' }); setSelectedItem(null); }}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </AnimatePresence>

      {/* Cart sheet */}
      <AnimatePresence>
        {showCart && (
          <CartSheet
            cart={cart} menuItems={menuItems} sym={sym}
            cartTotal={cartTotal} taxAmount={taxAmount} cartTotalWithTax={cartTotalWithTax}
            estimatedWait={estimatedWait} taxDisplay={settings.taxDisplay} taxRate={settings.taxRate}
            issues={cartIssues} sessionOrders={sessionOrders}
            onUpdateQty={updateQty} onRemove={removeFromCart}
            onClose={() => setShowCart(false)} onProceed={handleProceedToPayment}
          />
        )}
      </AnimatePresence>

      {/* Payment sheet */}
      <AnimatePresence>
        {showPayment && (
          <PaymentSheet
            cart={cart} menuItems={menuItems} sym={sym}
            cartTotalWithTax={cartTotalWithTax} taxAmount={taxAmount}
            taxDisplay={settings.taxDisplay} taxRate={settings.taxRate}
            orderMode={orderMode}
            displayName={
              orderMode === 'dine-in'
                ? (table?.name ?? 'Walk-in')
                : MODE_META[orderMode].label
            }
            scheduledDate={scheduledDate} scheduledTime={scheduledTime} timezone={settings.timezone}
            notes={notes} loading={checkoutLoading}
            customerName={customerName} customerPhone={customerPhone} deliveryAddress={deliveryAddress}
            customerInfoValid={customerInfoValid}
            onNotes={setNotes}
            onCustomerName={setCustomerName} onCustomerPhone={setCustomerPhone} onDeliveryAddress={setDeliveryAddress}
            onClose={() => { setShowPayment(false); releaseReservation(SESSION_ID); }}
            onPay={handlePayment}
          />
        )}
      </AnimatePresence>

      {/* Session orders sheet */}
      <AnimatePresence>
        {showSessionOrders && (
          <SessionOrdersSheet orders={sessionOrders} sym={sym} onClose={() => setShowSessionOrders(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
