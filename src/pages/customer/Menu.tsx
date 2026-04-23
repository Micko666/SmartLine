import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ShoppingBag, Plus, Minus, X, ChefHat, Clock, Search,
  CreditCard, Smartphone, Banknote, CheckCircle2, AlertTriangle,
  ClipboardList, Package, Bike, User, Phone, MapPin,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { CartItem, CartItemModifier, MenuItem, Order, PaymentMethod } from '@/domain/types';
import { ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';
import { getDeviceId, loadSession, saveSession, type SessionCartItem } from '@/lib/customerSession';
import { isSupabaseEnabled } from '@/store/flags';
import { useMenuSubscription } from '@/lib/supabase/realtime/useMenuSubscription';
import { fetchRestaurantByToken } from '@/lib/supabase/queries/public';

// ─── Unique stock-reservation session ID (per page load, intentionally fresh) ─
const SESSION_ID = `session-${Math.random().toString(36).slice(2)}`;

// ─── Order modes ──────────────────────────────────────────────────────────────
type OrderMode = 'dine-in' | 'takeaway' | 'delivery';

const MODE_META: Record<OrderMode, { label: string; icon: React.ElementType; subtitle: string; tableId: string }> = {
  'dine-in':  { label: 'Dine In',  icon: ChefHat,  subtitle: '',          tableId: '' },
  takeaway:   { label: 'Takeaway', icon: Package,   subtitle: '🥡 Takeaway — collect from counter', tableId: 'takeaway' },
  delivery:   { label: 'Delivery', icon: Bike,      subtitle: '🛵 Delivery — we bring it to you',   tableId: 'delivery' },
};

// ─── Dietary & allergen display maps ─────────────────────────────────────────
const DIETARY_EMOJI: Record<string, string> = {
  vegetarian:  '🥗',
  vegan:       '🌱',
  'gluten-free':'🌾',
  'dairy-free': '🥛',
  halal:       '☪️',
  kosher:      '✡️',
  spicy:       '🌶️',
};
const DIETARY_STYLE: Record<string, string> = {
  vegetarian:   'bg-green-500/10 text-green-700 border-green-200',
  vegan:        'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  'gluten-free':'bg-amber-500/10 text-amber-700 border-amber-200',
  'dairy-free': 'bg-blue-500/10 text-blue-700 border-blue-200',
  halal:        'bg-teal-500/10 text-teal-700 border-teal-200',
  kosher:       'bg-purple-500/10 text-purple-700 border-purple-200',
  spicy:        'bg-red-500/10 text-red-700 border-red-200',
};
const ALLERGEN_EMOJI: Record<string, string> = {
  gluten:    '🌾',
  dairy:     '🥛',
  eggs:      '🥚',
  nuts:      '🌰',
  peanuts:   '🥜',
  soy:       '🫘',
  shellfish: '🦞',
  fish:      '🐟',
  sesame:    '🫙',
};

// ─── Payment options ──────────────────────────────────────────────────────────
const PAYMENT_METHODS: { id: PaymentMethod; label: string; icon: React.ElementType }[] = [
  { id: 'card',       label: 'Credit / Debit Card',  icon: CreditCard },
  { id: 'google_pay', label: 'Google Pay',            icon: Smartphone },
  { id: 'apple_pay',  label: 'Apple Pay',             icon: Smartphone },
  { id: 'cash',       label: 'Pay at Counter',        icon: Banknote },
];

// ─── Stock badge ──────────────────────────────────────────────────────────────
function StockBadge({ stock, threshold }: { stock: number | null; threshold: number }) {
  if (stock === null) return null;
  if (stock === 0) return <span className="text-[10px] font-semibold text-destructive px-1.5 py-0.5 rounded-full bg-destructive/10">Unavailable</span>;
  if (stock === 1) return <span className="text-[10px] font-semibold text-destructive px-1.5 py-0.5 rounded-full bg-destructive/10 animate-pulse">Last one!</span>;
  if (stock <= threshold) return <span className="text-[10px] font-semibold text-warning px-1.5 py-0.5 rounded-full bg-warning/10">Only {stock} left</span>;
  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CustomerMenu() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // URL params — ?t=tableId for dine-in, ?mode=takeaway|delivery for off-premise
  const tableParam      = searchParams.get('t') ?? '';
  const modeParam       = searchParams.get('mode') ?? '';
  const restaurantToken = searchParams.get('r') ?? '';

  // Derive order mode
  const orderMode: OrderMode =
    modeParam === 'takeaway' ? 'takeaway' :
    modeParam === 'delivery' ? 'delivery' : 'dine-in';

  // The tableId sent to checkout — real UUID for dine-in, keyword for off-premise
  const effectiveTableId = orderMode === 'dine-in'
    ? (tableParam || 'walk-in')
    : MODE_META[orderMode].tableId;

  const {
    menuItems, categories, tables, settings, orders,
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
  const [sbUserId, setSbUserId] = useState<string | null>(null);
  const [menuLoading, setMenuLoading] = useState(isSupabaseEnabled() && !!restaurantToken);

  useEffect(() => {
    if (!isSupabaseEnabled() || !restaurantToken) return;
    fetchRestaurantByToken(restaurantToken).then(data => {
      if (data) {
        setSbUserId(data.userId);
        useStore.setState({
          menuItems: data.menuItems,
          settings:  data.settings,
          tables:    data.tables as import('@/domain/types').Table[],
        });
      }
      setMenuLoading(false);
    }).catch(() => setMenuLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantToken]);

  useMenuSubscription(sbUserId);

  const deviceId = useMemo(() => getDeviceId(), []);

  // ── Cart (restored from persisted session) ─────────────────────────────────
  const [cart, setCart] = useState<CartItem[]>(() => {
    if (!restaurantToken) return [];
    const session = loadSession(restaurantToken);
    if (!session || session.tableId !== effectiveTableId || session.placedOrderIds?.length) return [];
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
  const [selectedModifiers, setSelectedModifiers]  = useState<CartItemModifier[]>([]);
  const [paymentMethod,     setPaymentMethod]      = useState<PaymentMethod>('card');
  const [notes,             setNotes]              = useState('');
  const [checkoutLoading,   setCheckoutLoading]    = useState(false);
  const [cartIssues,        setCartIssues]         = useState<string[]>([]);

  // Customer info — collected at payment for takeaway / delivery
  const [customerName,     setCustomerName]     = useState('');
  const [customerPhone,    setCustomerPhone]    = useState('');
  const [deliveryAddress,  setDeliveryAddress]  = useState('');

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
    const inCart = cart.find(c => c.menuItemId === item.id)?.quantity ?? 0;
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
  const handlePayment = async () => {
    setCheckoutLoading(true);

    // Build notes: prepend customer contact info for takeaway / delivery
    let fullNotes = notes.trim();
    if (orderMode !== 'dine-in') {
      const infoLines = [
        `Name: ${customerName.trim()}`,
        `Phone: ${customerPhone.trim()}`,
        ...(orderMode === 'delivery' ? [`Address: ${deliveryAddress.trim()}`] : []),
      ].join('\n');
      fullNotes = [infoLines, fullNotes].filter(Boolean).join('\n---\n');
    }

    const result = await checkout({
      sessionId:       SESSION_ID,
      tableId:         effectiveTableId,
      paymentMethod,
      cart,
      notes:           fullNotes || undefined,
      restaurantToken: restaurantToken || undefined,
    });

    setCheckoutLoading(false);

    if (result.success) {
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
      setCartIssues([]);
      const params = new URLSearchParams();
      if (restaurantToken) params.set('r', restaurantToken);
      if (orderMode === 'dine-in' && tableParam) params.set('t', tableParam);
      else if (orderMode !== 'dine-in') params.set('mode', orderMode);
      navigate(`/receipt/${result.receipt.id}?${params.toString()}`);
    } else {
      const issues = result.unavailableItems;
      setCartIssues(issues);
      revalidateCart();
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
  const needsModeSelection = !menuLoading && !tableParam && !modeParam;
  if (needsModeSelection) {
    const selectMode = (mode: OrderMode) => {
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

          {/* Mode badge */}
          {orderMode !== 'dine-in' && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 text-primary text-[10px] font-semibold shrink-0">
              {orderMode === 'takeaway' ? <Package className="w-3 h-3" /> : <Bike className="w-3 h-3" />}
              {MODE_META[orderMode].label}
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
                            onClick={e => { e.stopPropagation(); addToCart(item); toast.success(`${item.name} added`); }}
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
            onAdd={(modifiers) => { addToCart(selectedItem, modifiers); toast.success(`${selectedItem.name} added`); setSelectedItem(null); }}
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
            paymentMethod={paymentMethod} notes={notes} loading={checkoutLoading}
            customerName={customerName} customerPhone={customerPhone} deliveryAddress={deliveryAddress}
            customerInfoValid={customerInfoValid}
            onPaymentMethod={setPaymentMethod} onNotes={setNotes}
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

// ─── Mode Selector Landing ────────────────────────────────────────────────────
// Shown when the customer arrives via the generic portal link (no ?t= or ?mode=).
// Lets them choose dine-in walk-in, takeaway, or delivery before seeing the menu.

function ModeSelectorScreen({
  businessName, logoUrl, openingHours,
  takeawayEnabled, deliveryEnabled, orderingPaused, orderingPausedMessage,
  onSelect,
}: {
  businessName: string; logoUrl: string; openingHours: string;
  takeawayEnabled: boolean; deliveryEnabled: boolean;
  orderingPaused: boolean; orderingPausedMessage: string;
  onSelect: (mode: OrderMode) => void;
}) {
  const options: { mode: OrderMode; icon: React.ElementType; title: string; desc: string; enabled: boolean }[] = [
    {
      mode:    'dine-in',
      icon:    ChefHat,
      title:   'Dine In',
      desc:    'Order from your table — food comes to you',
      enabled: true,
    },
    {
      mode:    'takeaway',
      icon:    Package,
      title:   'Takeaway',
      desc:    'Order ahead, collect at the counter',
      enabled: takeawayEnabled,
    },
    {
      mode:    'delivery',
      icon:    Bike,
      title:   'Delivery',
      desc:    'We bring it straight to your door',
      enabled: deliveryEnabled,
    },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="bg-card/90 backdrop-blur-xl border-b border-border">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            {logoUrl
              ? <img src={logoUrl} alt="logo" className="w-full h-full rounded-xl object-cover" />
              : <ChefHat className="w-4 h-4 text-primary-foreground" />}
          </div>
          <div>
            <p className="font-display font-bold text-sm">{businessName}</p>
            {openingHours && <p className="text-[10px] text-muted-foreground">{openingHours}</p>}
          </div>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 max-w-lg mx-auto w-full">
        {orderingPaused ? (
          <div className="text-center space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <ShoppingBag className="w-7 h-7 text-muted-foreground" />
            </div>
            <h1 className="font-display text-xl font-bold">Orders paused</h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              {orderingPausedMessage || "We're not taking orders right now. Check back soon!"}
            </p>
          </div>
        ) : (
          <>
            <div className="text-center mb-8">
              <h1 className="font-display text-2xl font-bold">How would you like to order?</h1>
              <p className="text-sm text-muted-foreground mt-1.5">Choose your preferred option below</p>
            </div>

            <div className="w-full space-y-3">
              {options.map(({ mode, icon: Icon, title, desc, enabled }) => (
                <motion.button
                  key={mode}
                  onClick={() => enabled && onSelect(mode)}
                  whileTap={enabled ? { scale: 0.98 } : undefined}
                  className={`w-full flex items-center gap-4 p-5 rounded-2xl border text-left transition-all
                    ${enabled
                      ? 'border-border bg-card hover:border-primary/40 hover:bg-primary/3 cursor-pointer'
                      : 'border-border/50 bg-muted/30 opacity-50 cursor-not-allowed'
                    }`}
                >
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${enabled ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Icon className={`w-6 h-6 ${enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-base leading-tight">{title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  {enabled && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Plus className="w-4 h-4 text-primary rotate-45" />
                    </div>
                  )}
                  {!enabled && (
                    <span className="text-[10px] font-semibold text-muted-foreground bg-muted px-2 py-1 rounded-full shrink-0">
                      Unavailable
                    </span>
                  )}
                </motion.button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Mode Unavailable ─────────────────────────────────────────────────────────
function ModeUnavailableScreen({ mode, businessName, logoUrl }: { mode: OrderMode; businessName: string; logoUrl: string }) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="w-full h-full rounded-2xl object-cover" />
        ) : (
          <ChefHat className="w-8 h-8 text-primary-foreground" />
        )}
      </div>
      <div>
        <h1 className="font-display text-xl font-bold">{businessName}</h1>
        <div className="mt-4 flex items-center justify-center gap-2 text-muted-foreground">
          <Icon className="w-5 h-5" />
          <span className="font-medium">{meta.label}</span>
        </div>
        <p className="text-muted-foreground text-sm mt-2">
          {meta.label} orders are not available right now.
        </p>
        <p className="text-xs text-muted-foreground mt-1">Please contact the restaurant or visit in person.</p>
      </div>
    </div>
  );
}

// ─── Item Detail Sheet ────────────────────────────────────────────────────────
function ItemSheet({ item, sym, onAdd, onClose }: {
  item: MenuItem; sym: string;
  onAdd: (modifiers: CartItemModifier[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<CartItemModifier[]>([]);

  const toggleModifier = (modId: string, optId: string) => {
    setSelected(prev => {
      const exists = prev.find(s => s.modifierId === modId && s.optionId === optId);
      if (exists) return prev.filter(s => !(s.modifierId === modId && s.optionId === optId));
      const mod = item.modifiers.find(m => m.id === modId);
      const filtered = mod?.maxSelections === 1 ? prev.filter(s => s.modifierId !== modId) : prev;
      return [...filtered, { modifierId: modId, optionId: optId }];
    });
  };

  const extraTotal = selected.reduce((sum, sel) => {
    const mod = item.modifiers.find(m => m.id === sel.modifierId);
    const opt = mod?.options.find(o => o.id === sel.optionId);
    return sum + (opt?.priceAdjustment ?? 0);
  }, 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl max-h-[85vh] overflow-y-auto"
      >
        <div className="max-w-lg mx-auto p-5 pb-8">
          <div className="flex justify-end mb-2">
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-4 h-4" /></button>
          </div>

          <div className="w-full h-48 rounded-2xl overflow-hidden bg-muted flex items-center justify-center mb-4">
            {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
              : item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
              : <span className="text-7xl">{item.icon}</span>}
          </div>

          <h2 className="font-display text-xl font-bold">{item.name}</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{item.description}</p>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <span className="font-bold text-2xl">{sym}{(item.price + extraTotal).toFixed(2)}</span>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {item.prepTime} min
            </span>
            {item.calories != null && (
              <span className="flex items-center gap-1 text-sm font-medium px-2.5 py-1 rounded-full bg-orange-500/10 text-orange-600 border border-orange-200/60">
                🔥 {item.calories} kcal
              </span>
            )}
          </div>

          {(item.dietaryTags?.length ?? 0) > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Dietary</p>
              <div className="flex gap-2 flex-wrap">
                {item.dietaryTags!.map(t => (
                  <span key={t} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${DIETARY_STYLE[t] ?? 'bg-green-500/10 text-green-700 border-green-200'}`}>
                    {DIETARY_EMOJI[t] && <span>{DIETARY_EMOJI[t]}</span>}
                    <span className="capitalize">{t}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {(item.allergens?.length ?? 0) > 0 && (
            <div className="mt-4 p-4 rounded-2xl bg-amber-50 border border-amber-200">
              <p className="text-xs font-bold text-amber-800 mb-2.5 flex items-center gap-1.5">⚠️ Contains allergens</p>
              <div className="flex flex-wrap gap-2">
                {item.allergens!.map(a => (
                  <span key={a} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 capitalize">
                    {ALLERGEN_EMOJI[a] && <span>{ALLERGEN_EMOJI[a]}</span>}{a}
                  </span>
                ))}
              </div>
            </div>
          )}

          {item.modifiers.map(mod => (
            <div key={mod.id} className="mt-4">
              <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                {mod.name} {mod.required && <span className="text-destructive">*</span>}
              </p>
              <div className="space-y-1.5">
                {mod.options.map(opt => {
                  const isSelected = selected.some(s => s.modifierId === mod.id && s.optionId === opt.id);
                  return (
                    <label key={opt.id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors cursor-pointer ${isSelected ? 'border-primary bg-primary/5' : 'border-border bg-muted/30'}`}>
                      <input type={mod.maxSelections === 1 ? 'radio' : 'checkbox'} checked={isSelected} onChange={() => toggleModifier(mod.id, opt.id)} className="accent-primary" />
                      <span className="text-sm flex-1">{opt.name}</span>
                      {opt.priceAdjustment !== 0 && <span className="text-xs font-medium text-muted-foreground">+{sym}{opt.priceAdjustment.toFixed(2)}</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <button
            onClick={() => onAdd(selected)}
            className="w-full h-13 mt-6 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity py-3"
          >
            <Plus className="w-4 h-4" />
            Add to Cart · {sym}{(item.price + extraTotal).toFixed(2)}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Cart Sheet ───────────────────────────────────────────────────────────────
function CartSheet({ cart, menuItems, sym, cartTotal, taxAmount, cartTotalWithTax, estimatedWait, taxDisplay, taxRate, issues, sessionOrders, onUpdateQty, onRemove, onClose, onProceed }: {
  cart: CartItem[]; menuItems: MenuItem[]; sym: string;
  cartTotal: number; taxAmount: number; cartTotalWithTax: number; estimatedWait: number;
  taxDisplay: string; taxRate: number; issues: string[];
  sessionOrders: Order[];
  onUpdateQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  onProceed: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl max-h-[85vh] overflow-y-auto"
      >
        <div className="max-w-lg mx-auto p-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display text-lg font-bold">Your Cart</h2>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-5 h-5" /></button>
          </div>

          {issues.length > 0 && (
            <div className="mb-4 p-3 rounded-xl bg-warning/10 border border-warning/30 text-warning text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Items updated</p>
                <p className="text-xs mt-0.5">{issues.join(', ')} {issues.length === 1 ? 'was' : 'were'} removed or reduced due to stock changes.</p>
              </div>
            </div>
          )}

          {cart.length === 0 ? (
            <div className="text-center py-10">
              <ShoppingBag className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Your cart is empty.</p>
            </div>
          ) : (
            <>
              <div className="space-y-4 mb-5">
                {cart.map(ci => {
                  const item = menuItems.find(m => m.id === ci.menuItemId);
                  if (!item) return null;
                  const modExtra = ci.selectedModifiers.reduce((s, sel) => {
                    const mod = item.modifiers.find(m => m.id === sel.modifierId);
                    const opt = mod?.options.find(o => o.id === sel.optionId);
                    return s + (opt?.priceAdjustment ?? 0);
                  }, 0);
                  const unitPrice = item.price + modExtra;
                  return (
                    <div key={`${ci.menuItemId}-${JSON.stringify(ci.selectedModifiers)}`} className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted flex items-center justify-center shrink-0">
                        {item.imageUrl || item.thumbnailUrl
                          ? <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                          : <span className="text-xl">{item.icon}</span>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        {ci.selectedModifiers.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {ci.selectedModifiers.map(sel => {
                              const mod = item.modifiers.find(m => m.id === sel.modifierId);
                              const opt = mod?.options.find(o => o.id === sel.optionId);
                              return opt?.name;
                            }).filter(Boolean).join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">{sym}{unitPrice.toFixed(2)} each</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => onUpdateQty(ci.menuItemId, -1)} className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center"><Minus className="w-3 h-3" /></button>
                        <span className="text-sm font-bold w-5 text-center">{ci.quantity}</span>
                        <button onClick={() => onUpdateQty(ci.menuItemId, 1)} className="w-7 h-7 rounded-xl bg-muted flex items-center justify-center"><Plus className="w-3 h-3" /></button>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{sym}{(unitPrice * ci.quantity).toFixed(2)}</p>
                        <button onClick={() => onRemove(ci.menuItemId)} className="text-xs text-destructive/60 hover:text-destructive"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-border pt-4 space-y-2 mb-5">
                <div className="flex justify-between text-sm"><span className="text-muted-foreground">Subtotal</span><span>{sym}{cartTotal.toFixed(2)}</span></div>
                {taxDisplay === 'exclusive' && taxAmount > 0 && (
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tax ({taxRate}%)</span><span>{sym}{taxAmount.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between font-bold text-base pt-1 border-t border-border">
                  <span>Total</span><span>{sym}{cartTotalWithTax.toFixed(2)}</span>
                </div>
                {estimatedWait > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                    <Clock className="w-3.5 h-3.5" /> ~{estimatedWait} min estimated wait
                  </div>
                )}
              </div>

              <button
                onClick={onProceed}
                className="w-full h-13 rounded-2xl bg-primary text-primary-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity py-3.5"
              >
                Proceed to Payment · {sym}{cartTotalWithTax.toFixed(2)}
              </button>
            </>
          )}

          {sessionOrders.length > 0 && (
            <div className="mt-6 pt-5 border-t border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Already ordered this visit</p>
              <div className="space-y-2">
                {sessionOrders.map(order => (
                  <div key={order.id} className="flex items-center justify-between py-2 px-3 rounded-xl bg-muted/40 text-sm">
                    <div>
                      <span className="font-semibold">#{order.orderNumber}</span>
                      <span className="text-muted-foreground ml-2">{order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(', ')}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                      <span className="font-medium">{sym}{order.total.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Payment Sheet ────────────────────────────────────────────────────────────
function PaymentSheet({ cart, menuItems, sym, cartTotalWithTax, taxAmount, taxDisplay, taxRate,
  orderMode, displayName, paymentMethod, notes, loading,
  customerName, customerPhone, deliveryAddress, customerInfoValid,
  onPaymentMethod, onNotes, onCustomerName, onCustomerPhone, onDeliveryAddress, onClose, onPay,
}: {
  cart: CartItem[]; menuItems: MenuItem[]; sym: string;
  cartTotalWithTax: number; taxAmount: number; taxDisplay: string; taxRate: number;
  orderMode: OrderMode; displayName: string;
  paymentMethod: PaymentMethod; notes: string; loading: boolean;
  customerName: string; customerPhone: string; deliveryAddress: string;
  customerInfoValid: boolean;
  onPaymentMethod: (m: PaymentMethod) => void;
  onNotes: (n: string) => void;
  onCustomerName: (v: string) => void;
  onCustomerPhone: (v: string) => void;
  onDeliveryAddress: (v: string) => void;
  onClose: () => void;
  onPay: () => void;
}) {
  const inputCls = 'w-full h-10 px-3.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="max-w-lg mx-auto p-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-lg font-bold">Payment</h2>
              {orderMode !== 'dine-in' && (
                <p className="text-xs text-muted-foreground mt-0.5">{MODE_META[orderMode].subtitle}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-5 h-5" /></button>
          </div>

          {/* Order summary */}
          <div className="glass-card p-4 mb-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
              Order summary · {displayName}
            </p>
            {cart.map(ci => {
              const item = menuItems.find(m => m.id === ci.menuItemId);
              if (!item) return null;
              const modExtra = ci.selectedModifiers.reduce((s, sel) => {
                const mod = item.modifiers.find(m => m.id === sel.modifierId);
                const opt = mod?.options.find(o => o.id === sel.optionId);
                return s + (opt?.priceAdjustment ?? 0);
              }, 0);
              return (
                <div key={`${ci.menuItemId}-${JSON.stringify(ci.selectedModifiers)}`} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{item.icon} {ci.quantity}× {item.name}</span>
                  <span className="font-medium">{sym}{((item.price + modExtra) * ci.quantity).toFixed(2)}</span>
                </div>
              );
            })}
            {taxDisplay === 'exclusive' && taxAmount > 0 && (
              <div className="flex justify-between text-sm pt-1 border-t border-border">
                <span className="text-muted-foreground">Tax ({taxRate}%)</span>
                <span>{sym}{taxAmount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base pt-2 border-t border-border">
              <span>Total</span><span>{sym}{cartTotalWithTax.toFixed(2)}</span>
            </div>
          </div>

          {/* Customer info — takeaway & delivery only */}
          {orderMode !== 'dine-in' && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Your Details</p>
              <div className="space-y-2.5">
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={customerName} onChange={e => onCustomerName(e.target.value)}
                    placeholder="Full name *"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    value={customerPhone} onChange={e => onCustomerPhone(e.target.value)}
                    placeholder="Phone number *" type="tel"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                {orderMode === 'delivery' && (
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                    <textarea
                      value={deliveryAddress} onChange={e => onDeliveryAddress(e.target.value)}
                      placeholder="Delivery address *" rows={2}
                      className="w-full px-3.5 pl-9 py-2.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors resize-none"
                    />
                  </div>
                )}
              </div>
              {!customerInfoValid && (
                <p className="text-xs text-destructive mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Please fill in all required fields above
                </p>
              )}
            </div>
          )}

          {/* Payment method */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Payment method</p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {PAYMENT_METHODS.map(({ id, label, icon: Icon }) => (
              <button
                key={id} onClick={() => onPaymentMethod(id)}
                className={`flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-colors ${paymentMethod === id ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-muted/30 text-foreground'}`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-left leading-tight">{label}</span>
                {paymentMethod === id && <CheckCircle2 className="w-3.5 h-3.5 ml-auto shrink-0" />}
              </button>
            ))}
          </div>

          {/* Notes */}
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Notes (optional)</p>
          <textarea
            value={notes} onChange={e => onNotes(e.target.value)}
            placeholder="Allergies, special requests…"
            rows={2}
            className="w-full px-3.5 py-2.5 rounded-xl border border-input bg-muted/50 text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors resize-none mb-5"
          />

          <button
            onClick={onPay} disabled={loading || !customerInfoValid}
            className="w-full h-14 rounded-2xl bg-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
                Processing…
              </span>
            ) : (
              <>Place Order · {sym}{cartTotalWithTax.toFixed(2)}</>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Session Orders Sheet ─────────────────────────────────────────────────────
function SessionOrdersSheet({ orders, sym, onClose }: { orders: Order[]; sym: string; onClose: () => void }) {
  const totalSpent = orders.reduce((sum, o) => sum + o.total, 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-sm" onClick={onClose}
    >
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28 }}
        onClick={e => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 bg-card rounded-t-3xl max-h-[85vh] overflow-y-auto"
      >
        <div className="max-w-lg mx-auto p-5 pb-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-lg font-bold">Your Orders This Visit</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Everything you've ordered since scanning in</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-xl bg-muted"><X className="w-5 h-5" /></button>
          </div>

          {orders.length === 0 ? (
            <div className="text-center py-10">
              <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No orders placed yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(order => (
                <div key={order.id} className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">#{order.orderNumber}</span>
                      <span className="text-xs text-muted-foreground">{order.tableName}</span>
                    </div>
                    <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                  </div>
                  <div className="space-y-1.5 mb-3">
                    {order.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {item.menuItemIcon} {item.quantity}× {item.menuItemName}
                          {item.modifiers.length > 0 && <span className="text-xs"> · {item.modifiers.map(m => m.optionName).join(', ')}</span>}
                        </span>
                        <span className="font-medium shrink-0 ml-3">{sym}{item.lineTotal.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between text-sm font-semibold pt-2 border-t border-border">
                    <span>Order total</span>
                    <span>{sym}{order.total.toFixed(2)}</span>
                  </div>
                </div>
              ))}
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/20">
                <div className="flex justify-between font-bold text-base">
                  <span>Total this visit</span>
                  <span className="text-primary">{sym}{totalSpent.toFixed(2)}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {orders.length} order{orders.length !== 1 ? 's' : ''} · payment at counter or as arranged
                </p>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
