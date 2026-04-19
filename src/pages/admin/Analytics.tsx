import { useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Clock, ShoppingBag, FlaskConical,
  AlertTriangle, RefreshCw, Zap, Monitor, Users,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { isRevenueOrder } from '@/domain/orderMachine';

// ─── Date range helpers ───────────────────────────────────────────────────────

type Range = '7d' | '30d' | '90d' | 'all';

function rangeLabel(r: Range) {
  return r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : r === '90d' ? 'Last 90 days' : 'All time';
}

function cutoffFor(r: Range): Date | null {
  if (r === 'all') return null;
  const d = new Date();
  d.setDate(d.getDate() - (r === '7d' ? 7 : r === '30d' ? 30 : 90));
  d.setHours(0, 0, 0, 0);
  return d;
}

function inRange(iso: string, cutoff: Date | null): boolean {
  if (!cutoff) return true;
  return new Date(iso) >= cutoff;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { orders, menuItems, ingredients, kitchenEvents, stations, settings } = useStore(useShallow(s => ({
    orders:        s.orders,
    menuItems:     s.menuItems,
    ingredients:   s.ingredients,
    kitchenEvents: s.kitchenEvents,
    stations:      s.stations,
    settings:      s.settings,
  })));

  const sym = settings.currencySymbol;
  const [range, setRange] = useState<Range>('30d');
  const cutoff = useMemo(() => cutoffFor(range), [range]);

  // ── Filtered slices ────────────────────────────────────────────────────────

  const filteredOrders = useMemo(
    () => orders.filter(o => isRevenueOrder(o.status) && inRange(o.createdAt, cutoff)),
    [orders, cutoff],
  );

  const filteredEvents = useMemo(
    () => kitchenEvents.filter(e => inRange(e.createdAt, cutoff)),
    [kitchenEvents, cutoff],
  );

  // ── Summary KPIs ───────────────────────────────────────────────────────────

  const totalRevenue = useMemo(() => filteredOrders.reduce((s, o) => s + o.total, 0), [filteredOrders]);
  const totalOrders  = filteredOrders.length;
  const avgOrder     = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const estimatedCOGS = useMemo(() =>
    menuItems.reduce((t, i) => i.costPerServing != null && i.salesCount > 0 ? t + i.costPerServing * i.salesCount : t, 0),
    [menuItems],
  );
  const estimatedRevFromCostItems = useMemo(() =>
    menuItems.reduce((t, i) => i.costPerServing != null && i.salesCount > 0 ? t + i.price * i.salesCount : t, 0),
    [menuItems],
  );
  const avgMarginPct = estimatedRevFromCostItems > 0
    ? Math.round(((estimatedRevFromCostItems - estimatedCOGS) / estimatedRevFromCostItems) * 100)
    : null;

  // ── Daily revenue chart ────────────────────────────────────────────────────

  const dailyRevenue = useMemo(() => {
    const days = range === 'all' ? 30 : parseInt(range);
    const buckets: Record<string, { day: string; revenue: number; orders: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), revenue: 0, orders: 0 };
    }
    filteredOrders.forEach(o => {
      const key = o.createdAt.slice(0, 10);
      if (buckets[key]) { buckets[key].revenue += o.total; buckets[key].orders += 1; }
    });
    return Object.values(buckets);
  }, [filteredOrders, range]);

  // ── Peak hours ─────────────────────────────────────────────────────────────

  const hourlyRevenue = useMemo(() => {
    const buckets: Record<number, { hour: string; revenue: number; orders: number }> = {};
    for (let h = 7; h <= 22; h++) buckets[h] = { hour: `${String(h).padStart(2, '0')}:00`, revenue: 0, orders: 0 };
    filteredOrders.forEach(o => {
      const h = new Date(o.createdAt).getHours();
      if (buckets[h]) { buckets[h].revenue += o.total; buckets[h].orders += 1; }
    });
    return Object.values(buckets);
  }, [filteredOrders]);

  // ── Avg prep time trend ────────────────────────────────────────────────────

  const avgPrepData = useMemo(() => {
    const days = Math.min(range === 'all' ? 30 : parseInt(range), 30);
    const buckets: Record<string, { day: string; avgPrep: number; count: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), avgPrep: 0, count: 0 };
    }
    orders.filter(o => o.status === 'completed' && inRange(o.createdAt, cutoff)).forEach(o => {
      const key = o.createdAt.slice(0, 10);
      if (buckets[key]) { buckets[key].avgPrep += o.estimatedPrepTime + o.prepTimeAdjustment; buckets[key].count += 1; }
    });
    return Object.values(buckets).map(d => ({ ...d, avgPrep: d.count > 0 ? Math.round(d.avgPrep / d.count) : 0 }));
  }, [orders, cutoff, range]);

  // ── Top & slow items ───────────────────────────────────────────────────────

  const { topItems, slowItems } = useMemo(() => {
    const active = menuItems.filter(m => m.status !== 'archived');
    const withSales = active.filter(i => i.salesCount > 0);
    const sorted = [...withSales].sort((a, b) => b.salesCount - a.salesCount);
    return {
      topItems: sorted.slice(0, 5),
      // "Slow moving" = items that *have* sold, just less than others.
      // Items with zero sales stay out so a fresh account doesn't see
      // its entire menu branded as slow movers.
      slowItems: sorted.length > 5 ? sorted.slice(-5).reverse() : [],
    };
  }, [menuItems]);

  // ── Station performance ────────────────────────────────────────────────────

  const stationPerformance = useMemo(() => {
    const map: Record<string, { name: string; color: string; delays: number; remakes: number; waste: number; notes: number; wasteCost: number }> = {};

    // Init all known stations
    stations.forEach(s => {
      map[s.id] = { name: s.name, color: s.color, delays: 0, remakes: 0, waste: 0, notes: 0, wasteCost: 0 };
    });
    // "Unknown" bucket for events without stationId
    map['__unknown'] = { name: 'Unattributed', color: '#94a3b8', delays: 0, remakes: 0, waste: 0, notes: 0, wasteCost: 0 };

    filteredEvents.forEach(e => {
      const key = e.stationId && map[e.stationId] ? e.stationId : '__unknown';
      if (!map[key]) return;
      if (e.type === 'delay')  map[key].delays++;
      if (e.type === 'remake') map[key].remakes++;
      if (e.type === 'waste')  { map[key].waste++; map[key].wasteCost += e.estimatedCost ?? 0; }
      if (e.type === 'note')   map[key].notes++;
    });

    return Object.values(map)
      .filter(s => s.delays + s.remakes + s.waste + s.notes > 0)
      .sort((a, b) => (b.delays + b.remakes + b.waste) - (a.delays + a.remakes + a.waste));
  }, [filteredEvents, stations]);

  // ── Kitchen events summary ─────────────────────────────────────────────────

  const kitchenSummary = useMemo(() => {
    const totalWaste  = filteredEvents.filter(e => e.type === 'waste').length;
    const totalRemake = filteredEvents.filter(e => e.type === 'remake').length;
    const totalDelay  = filteredEvents.filter(e => e.type === 'delay').length;
    const wasteCost   = filteredEvents.filter(e => e.type === 'waste').reduce((s, e) => s + (e.estimatedCost ?? 0), 0);

    // Events by day (last 14 days or range)
    const days = Math.min(range === 'all' ? 14 : parseInt(range), 14);
    const daily: Record<string, { day: string; delays: number; remakes: number; waste: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      daily[key] = { day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), delays: 0, remakes: 0, waste: 0 };
    }
    filteredEvents.forEach(e => {
      const key = e.createdAt.slice(0, 10);
      if (!daily[key]) return;
      if (e.type === 'delay')  daily[key].delays++;
      if (e.type === 'remake') daily[key].remakes++;
      if (e.type === 'waste')  daily[key].waste++;
    });

    return { totalWaste, totalRemake, totalDelay, wasteCost, daily: Object.values(daily) };
  }, [filteredEvents, range]);

  // ── Menu intelligence ──────────────────────────────────────────────────────

  const menuIntelligence = useMemo(() => {
    // Remake rate per item: how many times each item was mentioned in remake events
    const remakeCounts: Record<string, number> = {};
    filteredEvents.filter(e => e.type === 'remake' && e.menuItemId).forEach(e => {
      remakeCounts[e.menuItemId!] = (remakeCounts[e.menuItemId!] ?? 0) + 1;
    });

    const itemsWithRate = menuItems
      .filter(m => m.salesCount > 0 || remakeCounts[m.id])
      .map(m => ({
        id:        m.id,
        name:      m.name,
        icon:      m.icon,
        thumbnail: m.thumbnailUrl || m.imageUrl,
        sales:     m.salesCount,
        remakes:   remakeCounts[m.id] ?? 0,
        remakeRate: m.salesCount > 0 ? Math.round(((remakeCounts[m.id] ?? 0) / m.salesCount) * 100) : 0,
        prepTime:  m.prepTime,
      }))
      .sort((a, b) => b.remakeRate - a.remakeRate)
      .slice(0, 8);

    // Co-purchase pairs: which items appear together most often
    const pairCounts: Record<string, number> = {};
    filteredOrders.forEach(o => {
      const ids = o.items.map(i => i.menuItemId);
      for (let x = 0; x < ids.length; x++) {
        for (let y = x + 1; y < ids.length; y++) {
          const key = [ids[x], ids[y]].sort().join('||');
          pairCounts[key] = (pairCounts[key] ?? 0) + 1;
        }
      }
    });

    const topPairs = Object.entries(pairCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([key, count]) => {
        const [idA, idB] = key.split('||');
        const a = menuItems.find(m => m.id === idA);
        const b = menuItems.find(m => m.id === idB);
        return a && b ? { nameA: a.name, iconA: a.icon, nameB: b.name, iconB: b.icon, count } : null;
      })
      .filter(Boolean) as { nameA: string; iconA: string; nameB: string; iconB: string; count: number }[];

    return { itemsWithRate, topPairs };
  }, [filteredOrders, filteredEvents, menuItems]);

  // ── Ingredient spend ───────────────────────────────────────────────────────

  const monthlyIngredientSpend = useMemo(() => {
    const usage: Record<string, { name: string; unit: string; costPerUnit: number; totalQty: number }> = {};
    filteredOrders.forEach(order => {
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
  }, [filteredOrders, menuItems, ingredients]);

  const totalIngredientCost = monthlyIngredientSpend.reduce((s, i) => s + i.totalCost, 0);

  // ─────────────────────────────────────────────────────────────────────────

  const RANGES: Range[] = ['7d', '30d', '90d', 'all'];

  return (
    <DashboardLayout>
      <div className="space-y-6">

        {/* Header + range selector */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-2xl font-bold">Analytics</h1>
            <p className="text-muted-foreground text-sm mt-0.5">All metrics derived from real transactions</p>
          </div>
          <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
            {RANGES.map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  range === r
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {rangeLabel(r)}
              </button>
            ))}
          </div>
        </div>

        {/* Summary KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Revenue',       value: `${sym}${totalRevenue.toFixed(0)}`,  icon: TrendingUp,  color: 'text-success' },
            { label: 'Orders',        value: String(totalOrders),                  icon: ShoppingBag, color: 'text-info' },
            { label: 'Avg Order',     value: `${sym}${avgOrder.toFixed(2)}`,       icon: TrendingUp,  color: 'text-primary' },
            {
              label: avgMarginPct !== null ? 'Est. Gross Margin' : 'Active Items',
              value: avgMarginPct !== null ? `${avgMarginPct}%` : String(menuItems.filter(i => i.status === 'active').length),
              icon: Clock,
              color: avgMarginPct !== null
                ? (avgMarginPct >= 60 ? 'text-success' : avgMarginPct >= 40 ? 'text-warning' : 'text-destructive')
                : 'text-warning',
            },
          ].map(kpi => (
            <div key={kpi.label} className="kpi-card">
              <kpi.icon className={`w-5 h-5 ${kpi.color} mb-3`} />
              <p className="font-display text-xl font-bold">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
            </div>
          ))}
        </div>

        {/* Revenue chart */}
        <div className="glass-card p-5">
          <h3 className="font-display font-semibold mb-4">Revenue — {rangeLabel(range)}</h3>
          {totalRevenue === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">No orders in this period</div>
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
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,70%)" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${sym}${v.toFixed(2)}`, 'Revenue']} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(160,84%,29%)" fill="url(#revGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {/* Peak hours */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Peak Hours</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hourlyRevenue}>
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [String(v), 'Orders']} />
                <Bar dataKey="orders" fill="hsl(210,100%,52%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Avg prep time */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Avg Prep Time Trend</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={avgPrepData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,10%,92%)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(220,10%,70%)" unit="m" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${v}m`, 'Avg prep']} />
                <Line type="monotone" dataKey="avgPrep" stroke="hsl(38,92%,50%)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* ── Kitchen Events ── */}
        {(kitchenSummary.totalDelay + kitchenSummary.totalRemake + kitchenSummary.totalWaste > 0) && (
          <div className="glass-card p-5 space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="font-display font-semibold flex items-center gap-2">
                <Zap className="w-4 h-4 text-warning" /> Kitchen Events
              </h3>
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-destructive font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" /> {kitchenSummary.totalDelay} delays
                </span>
                <span className="flex items-center gap-1.5 text-warning font-medium">
                  <RefreshCw className="w-3.5 h-3.5" /> {kitchenSummary.totalRemake} remakes
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground font-medium">
                  {kitchenSummary.totalWaste} waste
                  {kitchenSummary.wasteCost > 0 && <span className="text-destructive">({sym}{kitchenSummary.wasteCost.toFixed(2)})</span>}
                </span>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={kitchenSummary.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,10%,92%)" />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="delays"  fill="hsl(0,84%,60%)"   radius={[3, 3, 0, 0]} name="Delays"  stackId="a" />
                <Bar dataKey="remakes" fill="hsl(38,92%,50%)"  radius={[3, 3, 0, 0]} name="Remakes" stackId="a" />
                <Bar dataKey="waste"   fill="hsl(220,10%,65%)" radius={[3, 3, 0, 0]} name="Waste"   stackId="a" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Station Performance ── */}
        {stationPerformance.length > 0 && (
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <Monitor className="w-4 h-4 text-primary" /> Station Performance
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border">
                    <th className="text-left pb-2 font-medium">Station</th>
                    <th className="text-right pb-2 font-medium">Delays</th>
                    <th className="text-right pb-2 font-medium">Remakes</th>
                    <th className="text-right pb-2 font-medium">Waste</th>
                    <th className="text-right pb-2 font-medium">Waste cost</th>
                    <th className="text-right pb-2 font-medium">Notes</th>
                    <th className="text-right pb-2 font-medium">Total events</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stationPerformance.map(s => {
                    const total = s.delays + s.remakes + s.waste + s.notes;
                    return (
                      <tr key={s.name} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="font-medium">{s.name}</span>
                          </div>
                        </td>
                        <td className="text-right py-2.5">
                          <span className={s.delays > 0 ? 'text-destructive font-semibold' : 'text-muted-foreground'}>{s.delays}</span>
                        </td>
                        <td className="text-right py-2.5">
                          <span className={s.remakes > 0 ? 'text-warning font-semibold' : 'text-muted-foreground'}>{s.remakes}</span>
                        </td>
                        <td className="text-right py-2.5 text-muted-foreground">{s.waste}</td>
                        <td className="text-right py-2.5">
                          {s.wasteCost > 0
                            ? <span className="text-destructive font-medium">{sym}{s.wasteCost.toFixed(2)}</span>
                            : <span className="text-muted-foreground">—</span>
                          }
                        </td>
                        <td className="text-right py-2.5 text-muted-foreground">{s.notes}</td>
                        <td className="text-right py-2.5 font-semibold">{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Menu Intelligence ── */}
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Remake rates */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-warning" /> Remake Rate by Item
            </h3>
            {menuIntelligence.itemsWithRate.length === 0 ? (
              <p className="text-sm text-muted-foreground">No event data yet for this period.</p>
            ) : (
              <div className="space-y-2.5">
                {menuIntelligence.itemsWithRate.map(item => (
                  <div key={item.id} className="flex items-center gap-3">
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt={item.name} className="w-7 h-7 rounded-lg object-cover shrink-0" />
                    ) : (
                      <span className="text-base shrink-0">{item.icon}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <span className={`text-xs font-bold shrink-0 ${
                          item.remakeRate >= 10 ? 'text-destructive' : item.remakeRate >= 5 ? 'text-warning' : 'text-muted-foreground'
                        }`}>
                          {item.remakeRate}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${item.remakeRate >= 10 ? 'bg-destructive' : item.remakeRate >= 5 ? 'bg-warning' : 'bg-muted-foreground/40'}`}
                            style={{ width: `${Math.min(item.remakeRate * 5, 100)}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{item.remakes}/{item.sales} sold</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Co-purchase pairs */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <Users className="w-4 h-4 text-info" /> Frequently Ordered Together
            </h3>
            {menuIntelligence.topPairs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough multi-item orders in this period.</p>
            ) : (
              <div className="space-y-3">
                {menuIntelligence.topPairs.map((pair, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">{i + 1}</span>
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      <span className="text-base">{pair.iconA}</span>
                      <span className="text-xs font-medium truncate max-w-[80px]">{pair.nameA}</span>
                      <span className="text-muted-foreground text-xs shrink-0">+</span>
                      <span className="text-base">{pair.iconB}</span>
                      <span className="text-xs font-medium truncate max-w-[80px]">{pair.nameB}</span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-sm font-semibold">{pair.count}</span>
                      <span className="text-xs text-muted-foreground ml-1">times</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Top/Slow items */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-success" /> Top Selling
            </h3>
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

          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-warning" /> Slow Moving
            </h3>
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

        {/* Ingredient spend */}
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-semibold flex items-center gap-2">
              <FlaskConical className="w-4 h-4 text-primary" /> Ingredient Spend — {rangeLabel(range)}
            </h3>
            {totalIngredientCost > 0 && (
              <span className="text-sm font-bold text-destructive">{sym}{totalIngredientCost.toFixed(2)} total</span>
            )}
          </div>
          {monthlyIngredientSpend.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {ingredients.length === 0
                ? 'Add ingredients and link them to menu items to see spending here.'
                : 'No orders with recipe data in this period.'}
            </p>
          ) : (
            <div className="space-y-2">
              {monthlyIngredientSpend.map(ing => {
                const pct = totalIngredientCost > 0 ? Math.round((ing.totalCost / totalIngredientCost) * 100) : 0;
                return (
                  <div key={ing.name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium truncate">{ing.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {ing.totalQty % 1 === 0 ? ing.totalQty : ing.totalQty.toFixed(2)} {ing.unit}
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
