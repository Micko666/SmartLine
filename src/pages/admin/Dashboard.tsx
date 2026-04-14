import { useMemo } from 'react';
import { TrendingUp, ShoppingBag, Clock, Flame, AlertTriangle, CheckCircle2, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { motion } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { isActiveOrder, isRevenueOrder, ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';
import type { Order } from '@/domain/types';

function timeAgo(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : `${m}m ago`;
}

const CHART_COLORS = ['hsl(160,84%,29%)', 'hsl(38,92%,50%)', 'hsl(210,100%,52%)', 'hsl(220,14%,70%)'];

export default function Dashboard() {
  const { orders, menuItems, settings } = useStore(useShallow(s => ({
    orders: s.orders,
    menuItems: s.menuItems,
    settings: s.settings,
  })));

  const sym = settings.currencySymbol;

  // ── Derived stats from real orders ──
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = orders.filter(
      o => new Date(o.createdAt) >= today && isRevenueOrder(o.status),
    );

    const activeOrders = orders.filter(o => isActiveOrder(o.status));

    const todayRevenue = todayOrders.reduce((sum, o) => sum + o.total, 0);

    const completedToday = todayOrders.filter(o => o.status === 'completed');
    const totalToday = todayOrders.length;
    const completionRate = totalToday > 0 ? (completedToday.length / totalToday) * 100 : 0;

    const prepOrders = orders.filter(o => o.status === 'completed');
    const avgPrepTime = prepOrders.length > 0
      ? prepOrders.reduce((s, o) => s + o.estimatedPrepTime + o.prepTimeAdjustment, 0) / prepOrders.length
      : 0;

    const lowStockCount = menuItems.filter(
      i => i.stock !== null && i.stock > 0 && i.stock <= settings.lowStockThreshold,
    ).length;

    return { todayRevenue, todayOrderCount: todayOrders.length, activeOrders, completionRate, avgPrepTime, lowStockCount };
  }, [orders, menuItems, settings]);

  // ── Hourly chart: bucket today's orders ──
  const hourlyData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets: Record<number, { orders: number; revenue: number }> = {};
    for (let h = 7; h <= 22; h++) buckets[h] = { orders: 0, revenue: 0 };

    orders
      .filter(o => new Date(o.createdAt) >= today && isRevenueOrder(o.status))
      .forEach(o => {
        const h = new Date(o.createdAt).getHours();
        if (buckets[h]) { buckets[h].orders += 1; buckets[h].revenue += o.total; }
      });

    return Object.entries(buckets).map(([h, v]) => ({
      hour: `${String(h).padStart(2, '0')}:00`,
      orders: v.orders,
      revenue: Math.round(v.revenue),
    }));
  }, [orders]);

  // ── Status distribution ──
  const statusDist = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach(o => { counts[o.status] = (counts[o.status] ?? 0) + 1; });
    return Object.entries(counts).map(([status, value], i) => ({
      status: ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ?? status,
      value,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    }));
  }, [orders]);

  // ── Top selling items (from store salesCount) ──
  const topItems = useMemo(
    () => [...menuItems].sort((a, b) => b.salesCount - a.salesCount).slice(0, 5),
    [menuItems],
  );

  // ── Live active orders ──
  const liveOrders = stats.activeOrders.slice(0, 6);

  const kpis = [
    { label: "Today's Revenue", value: `${sym}${stats.todayRevenue.toFixed(0)}`, change: `${stats.todayOrderCount} orders`, up: true, icon: TrendingUp, color: 'text-success' },
    { label: "Today's Orders",  value: String(stats.todayOrderCount), change: `${stats.activeOrders.length} active`, up: true, icon: ShoppingBag, color: 'text-info' },
    { label: 'Avg Prep Time',   value: `${stats.avgPrepTime.toFixed(1)} min`, change: 'from completed', up: true, icon: Clock, color: 'text-warning' },
    { label: 'Active Orders',   value: String(stats.activeOrders.length), change: `${stats.activeOrders.filter(o => o.status === 'preparing').length} preparing`, up: false, icon: Flame, color: 'text-destructive' },
    { label: 'Low Stock Alerts', value: String(stats.lowStockCount), change: stats.lowStockCount > 0 ? 'Needs attention' : 'All stocked', up: stats.lowStockCount === 0, icon: AlertTriangle, color: 'text-warning' },
    { label: 'Completion Rate',  value: `${stats.completionRate.toFixed(1)}%`, change: 'today', up: stats.completionRate >= 90, icon: CheckCircle2, color: 'text-success' },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Real-time overview of your operations</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpis.map((kpi, i) => (
            <motion.div key={kpi.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="kpi-card">
              <div className="flex items-center justify-between mb-3">
                <kpi.icon className={`w-5 h-5 ${kpi.color}`} />
                {kpi.up ? <ArrowUpRight className="w-3.5 h-3.5 text-success" /> : <ArrowDownRight className="w-3.5 h-3.5 text-warning" />}
              </div>
              <p className="font-display text-xl font-bold">{kpi.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
              <p className="text-[11px] text-muted-foreground mt-1">{kpi.change}</p>
            </motion.div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="glass-card p-5 lg:col-span-2">
            <h3 className="font-display font-semibold mb-4">Orders by Hour (Today)</h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={hourlyData}>
                <defs>
                  <linearGradient id="colorOrders" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(160,84%,29%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(160,84%,29%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid hsl(220,13%,90%)', fontSize: 12 }} />
                <Area type="monotone" dataKey="orders" stroke="hsl(160,84%,29%)" fill="url(#colorOrders)" strokeWidth={2} name="Orders" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Order Status</h3>
            {statusDist.length === 0 ? (
              <div className="h-[180px] flex items-center justify-center text-sm text-muted-foreground">No orders yet</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={statusDist} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                      {statusDist.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2 mt-2 justify-center">
                  {statusDist.map(s => (
                    <div key={s.status} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: s.fill }} />
                      {s.status} ({s.value})
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Revenue this week */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Revenue by Hour</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={hourlyData}>
                <XAxis dataKey="hour" tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(220,10%,70%)" />
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => [`${sym}${v}`, 'Revenue']} />
                <Bar dataKey="revenue" fill="hsl(160,84%,29%)" radius={[4, 4, 0, 0]} name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top Selling */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Top Selling Items</h3>
            {topItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales data yet.</p>
            ) : (
              <div className="space-y-3">
                {topItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
                    ) : (
                      <span className="text-lg shrink-0">{item.icon}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{sym}{item.price.toFixed(2)}</p>
                    </div>
                    <span className="text-xs font-semibold text-muted-foreground shrink-0">{item.salesCount} sold</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live Orders */}
          <div className="glass-card p-5">
            <h3 className="font-display font-semibold mb-4">Live Orders</h3>
            {liveOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active orders.</p>
            ) : (
              <div className="space-y-2.5">
                {liveOrders.map((order: Order) => (
                  <div key={order.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">#{order.orderNumber}</span>
                        <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{order.tableName} · {order.items.length} item{order.items.length !== 1 ? 's' : ''} · {sym}{order.total.toFixed(2)}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">{timeAgo(order.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
