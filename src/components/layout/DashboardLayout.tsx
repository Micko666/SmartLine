import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingBag, UtensilsCrossed, Package, BarChart3,
  Settings, LogOut, ChefHat, Menu, X, Bell, Clock, TableProperties, ExternalLink,
  FlaskConical, Monitor,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { useOrdersSubscription } from '@/lib/supabase/realtime/useOrdersSubscription';

const navItems = [
  { path: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { path: '/orders',       label: 'Orders',        icon: ShoppingBag },
  { path: '/menu-manager', label: 'Menu',          icon: UtensilsCrossed },
  { path: '/ingredients',  label: 'Ingredients',  icon: FlaskConical },
  { path: '/inventory',    label: 'Inventory',     icon: Package },
  { path: '/tables',       label: 'Tables & QR',   icon: TableProperties },
  { path: '/prep-times',   label: 'Prep Times',    icon: Clock },
  { path: '/analytics',    label: 'Analytics',     icon: BarChart3 },
  { path: '/stations',     label: 'Stations',      icon: Monitor },
  { path: '/settings',     label: 'Settings',      icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Real-time order sync across all devices
  useOrdersSubscription();

  const { logout, user, orders, menuItems, settings } = useStore(useShallow(s => ({
    logout: s.logout,
    user: s.user,
    orders: s.orders,
    menuItems: s.menuItems,
    settings: s.settings,
  })));

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Unread active orders for badge
  const activeCount = orders.filter(o =>
    o.status === 'paid' || o.status === 'preparing' || o.status === 'ready',
  ).length;

  const lowStockCount = menuItems.filter(
    i => i.stock !== null && i.stock <= settings.lowStockThreshold && i.stock > 0,
  ).length;

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-foreground text-lg leading-tight truncate">SmartLine</h1>
            <p className="text-[11px] text-muted-foreground truncate">{user?.businessName ?? 'Operations Platform'}</p>
          </div>
          <button className="lg:hidden ml-auto text-muted-foreground shrink-0" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {navItems.map(item => {
            const active = location.pathname === item.path;
            const isOrders = item.path === '/orders';
            return (
              <Link
                key={item.path} to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={active ? 'sidebar-link-active' : 'sidebar-link'}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                <span className="flex-1">{item.label}</span>
                {isOrders && activeCount > 0 && (
                  <span className="ml-auto text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center">{activeCount > 9 ? '9+' : activeCount}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border space-y-0.5">
          <a
            href={`/menu`} target="_blank" rel="noopener noreferrer"
            className="sidebar-link text-primary font-semibold"
            onClick={() => setSidebarOpen(false)}
          >
            <ExternalLink className="w-[18px] h-[18px]" />
            Customer Menu
          </a>
          <button onClick={handleLogout} className="sidebar-link w-full text-destructive">
            <LogOut className="w-[18px] h-[18px]" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar */}
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur-sm flex items-center px-4 gap-3 shrink-0">
          <button className="lg:hidden text-muted-foreground" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          {lowStockCount > 0 && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-warning font-medium px-2.5 py-1 bg-warning/10 rounded-lg">
              <Package className="w-3.5 h-3.5" />
              {lowStockCount} low stock
            </span>
          )}
          <Link to="/orders" className="relative p-2 rounded-xl hover:bg-muted transition-colors">
            <Bell className="w-5 h-5 text-muted-foreground" />
            {activeCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-destructive rounded-full" />
            )}
          </Link>
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary select-none">
            {initials}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
