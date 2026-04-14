import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Clock, ShoppingBag, FlaskConical } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { isRevenueOrder } from '@/domain/orderMachine';

export default function Analytics() {
  const { orders, menuItems, ingredients, settings } = useStore(useShallow(s => ({
    orders: s.orders,
    menuItems: s.menuItems,
    ingredients: s.ingredients,
    settings: s.settings,
  })));

  const sym = settings.currencySymbol;

  // ── Last 7 days revenue ──
  const dailyRevenue = useMemo(() => {
    const days: Record<string, { day: string; revenue: number; orders: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      days[key] = { day: label, revenue: 0, orders: 0 };
    }
    orders.filter(o => isRevenueOrder(o.status)).forEach(o => {
      const key = o.createdAt.slice(0, 10);
      if (days[key]) {
        days[key].revenue += o.total;
        days[key].orders += 1;
      }
    });
    return Object.values(days);
  }, [orders]);

  // ── Revenue by hour of day (all time) ──
  const hourlyRevenue = useMemo(() => {
    const buckets: Record<number, { hour: string; revenue: number; orders: number }> = {};
    for (let h = 7; h <= 22; h++) buckets[h] = { hour: `${String(h).padStart(2, '0')}:00`, revenue: 0, orders: 0 };
    orders.filter(o => isRevenueOrder(o.status)).forEach(o => {
      const h = new Date(o.createdAt).getHours();
      if (buckets[h]) { buckets[h].revenue += o.total; buckets[h].orders += 1; }
    });
    return Object.values(buckets);
  }, [orders]);

  // ── Top & bottom items ──
  const { topItems, slowItems } = useMemo(() => {
    const sorted = [...menuItems].sort((a, b) => b.salesCount - a.salesCount);
    return { topItems: sorted.slice(0, 5), slowItems: sorted.slice(-5).reverse() };
  }, [menuItems]);

  // ── Average prep time over last 7 days ──
  const avgPrepData = useMemo(() => {
    const days: Record<string, { day: string; avgPrep: number; count: number }> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      days[key] = { day: d.toLocaleDateString('en-US', { weekday: 'short' }), avgPrep: 0, count: 0 };
    }
    orders.filter(o => o.status === 'completed').forEach(o => {
      const key = o.createdAt.slice(0, 10);
      if (days[key]) {
        days[key].avgPrep += o.estimatedPrepTime + o.prepTimeAdjustment;
        days[key].count += 1;
      }
    });
    return Object.values(days).map(d => ({ ...d, avgPrep: d.count > 0 ? Math.round(d.avgPrep / d.count) : 0 }));
  }, [orders]);

  const totalRevenue = orders.filter(o => isRevenueOrder(o.status)).reduce((s, o) => s + o.total, 0);
  const totalOrders = orders.filter(o => isRevenueOrder(o.status)).length;
  const avgOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Estimated COGS from menu item cost data × sales counts
  const estimatedCOGS = useMemo(() => {
    return menuItems.reduce((total, item) => {
      if (item.costPerServing == null || item.salesCount === 0) return total;
      return total + item.costPerServing * item.salesCount;
    }, 0);
  }, [menuItems]);

  const estimatedRevFromCostItems = useMemo(() => {
    return menuItems.reduce((total, item) => {
      if (item.costPerServing == null || item.salesCount === 0) return total;
      return total + item.price * item.salesCount;
    }, 0);
  }, [menuItems]);

  const avgMarginPct = estimatedRevFromCostItems > 0
    ? Math.round(((estimatedRevFromCostItems - estimatedCOGS) / estimatedRevFromCostItems) * 100)
    : null;

  // ── Monthly ingredient spending (current calendar month) ──
  const monthlyIngredientSpend = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const monthOrders = orders.filter(o => isRevenueOrder(o.status) && o.createdAt.slice(0, 10) >= monthStart);

    const usage: Record<string, { name: string; unit: string; costPerUnit: number; totalQty: number }> = {};
    monthOrders.forEach(order => {
      order.items.forEach(orderItem => {
        const menuItem = menuItems.find(m => m.id === orderItem.menuItemId);
        if (!menuItem?.recipe?.length) return;
        menuItem.recipe.forEach(ri => {
          const ing = ingredients.find(i => i.id === ri.ingredientId);
          if (!ing) return;
          if (!usage[ing.id]) usage[ing.id] = { name: ing.name, unit: ing.unit, costPerUnit: ing.costPerUnit, totalQty: 0 };
          usage[ing.id].totalQty += ri.quantity * orderItem.quantity;
        });
      });
    });

    return Object.values(usage)
      .map(u => ({ ...u, totalCost: u.totalQty * u.costPerUnit }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [orders, menuItems, ingredients]);

  const totalMonthlyIngredientCost = monthlyIngredientSpend.reduce((s, i) => s + i.totalCost, 0);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground text-sm mt-0.5">All metrics derived from real transactions</p>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Total Revenue',    value: `${sym}${totalRevenue.toFixed(0)}`,  icon: TrendingUp, color: 'text-success' },
            { label: 'Total Orders',     value: String(totalOrders),                  icon: ShoppingBag, color: 'text-info' },
            { label: 'Avg Order Value',  value: `${sym}${avgOrder.toFixed(2)}`,       icon: TrendingUp, color: 'text-primary' },
            {
              label: avgMarginPct !== null ? 'Est. Gross Margin' : 'Active Items',
              value: avgMarginPct !== null ? `${avgMarginPct}%` : String(menuItems.filter(i => i.status === 'active').length),
              icon: Clock,
              color: avgMarginPct !== null ? (avgMarginPct >= 60 ? 'text-success' : avgMarginPct >= 40 ? 'text-warning' : 'text-destructive') : 'text-warning',
            },
          ].map(kpi => (
            <div key={kpi.label} className="kpi-card">
              <kpi.icon className={`w-5 h-5 ${kpi.color} mb-3`} />
              <p className="font-display text-xl font-bold">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Revenue 7 days */}
        <div className="glass-card p-5">
          <h3 className="font-display font-semibold mb-4">Revenue — Last 7 Days</h3>
          {totalRevenue === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Place some orders to see data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={dailyRevenue}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(160,84%,29%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(160,84%,29%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,10%,92%)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(220,10%,70%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,70%)" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${sym}${v.toFixed(2)}`, 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(160,84%,29%)" fill="url(#revGrad)" strokeWidth={2} name="Revenue" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Peak hours */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Peak Hours (All Time)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourlyRevenue}>
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [String(v), 'Orders']} />
                <Bar dataKey="orders" fill="hsl(210,100%,52%)" radius={[4, 4, 0, 0]} name="Orders" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Avg prep time */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Avg Prep Time — Last 7 Days</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={avgPrepData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,10%,92%)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="hsl(220,10%,70%)" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,70%)" unit="m" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${v}m`, 'Avg prep']} />
                <Line type="monotone" dataKey="avgPrep" stroke="hsl(38,92%,50%)" strokeWidth={2} dot={{ r: 4 }} name="Avg Prep" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Top selling */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-success" /> Top Selling</h3>
            <div className="space-y-3">
              {topItems.map((item, i) => {
                const margin = item.costPerServing != null ? item.price - item.costPerServing : null;
                const marginPct = margin != null && item.price > 0 ? Math.round((margin / item.price) * 100) : null;
                return (
                  <div key={item.id} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    {item.imageUrl || item.thumbnailUrl ? (
                      <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                    ) : (
                      <span className="text-xl shrink-0">{item.icon}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-xs text-muted-foreground">{sym}{item.price.toFixed(2)}</p>
                        {marginPct !== null && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${marginPct >= 60 ? 'bg-success/10 text-success' : marginPct >= 40 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive'}`}>
                            {marginPct}% margin
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{item.salesCount}</p>
                      <p className="text-xs text-muted-foreground">sold</p>
                    </div>
                  </div>
                );
              })}
              {topItems.length === 0 && <p className="text-sm text-muted-foreground">No sales data yet.</p>}
            </div>
          </div>

          {/* Slow moving */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-warning" /> Slow Moving</h3>
            <div className="space-y-3">
              {slowItems.map((item, i) => (
                <div key={item.id} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                  {item.imageUrl || item.thumbnailUrl ? (
                    <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                  ) : (
                    <span className="text-xl shrink-0">{item.icon}</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{sym}{item.price.toFixed(2)}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{item.salesCount}</p>
                    <p className="text-xs text-muted-foreground">sold</p>
                  </div>
                </div>
              ))}
              {slowItems.length === 0 && <p className="text-sm text-muted-foreground">No sales data yet.</p>}
            </div>
          </div>
        </div>

        {/* Ingredient spend this month */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" /> Ingredient Spend — This Month
            </h3>
            {totalMonthlyIngredientCost > 0 && (
              <span className="text-sm font-bold text-destructive">{sym}{totalMonthlyIngredientCost.toFixed(2)} total</span>
            )}
          </div>

          {monthlyIngredientSpend.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ingredients.length === 0
                ? 'Add ingredients in the Ingredients page and link them to menu items to see spending here.'
                : 'No orders with recipe data yet this month.'}
            </p>
          ) : (
            <div className="space-y-2">
              {monthlyIngredientSpend.map(ing => {
                const pct = totalMonthlyIngredientCost > 0
                  ? Math.round((ing.totalCost / totalMonthlyIngredientCost) * 100)
                  : 0;
                return (
                  <div key={ing.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{ing.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {ing.totalQty % 1 === 0 ? ing.totalQty : ing.totalQty.toFixed(2)} {ing.unit} used
                        </span>
                      </div>
                      <div className="text-right shrink-0 ml-3">
                        <span className="font-semibold">{sym}{ing.totalCost.toFixed(2)}</span>
                        <span className="text-xs text-muted-foreground ml-1.5">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
