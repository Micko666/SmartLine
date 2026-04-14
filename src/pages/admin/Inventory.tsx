import { useState } from 'react';
import { AlertTriangle, Package, Plus, Minus, RotateCcw, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';

export default function Inventory() {
  const { menuItems, adjustStock, setStock, restockItem, settings } = useStore(useShallow(s => ({
    menuItems: s.menuItems,
    adjustStock: s.adjustStock,
    setStock: s.setStock,
    restockItem: s.restockItem,
    settings: s.settings,
  })));

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const sym = settings.currencySymbol;
  const threshold = settings.lowStockThreshold;

  const tracked = menuItems.filter(i => i.status !== 'archived' && i.stock !== null);

  const lowStock = tracked.filter(i => i.stock! > 0 && i.stock! <= threshold);
  const outOfStock = tracked.filter(i => i.stock === 0);

  const visible = tracked
    .filter(i => {
      if (filter === 'low') return i.stock! > 0 && i.stock! <= threshold;
      if (filter === 'out') return i.stock === 0;
      return true;
    })
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()));

  const handleAdjust = (id: string, name: string, delta: number) => {
    adjustStock(id, delta);
  };

  const handleRestock = (id: string, name: string) => {
    restockItem(id);
    toast.success(`${name} restocked to max`);
  };

  const handleSetStock = (id: string, value: string) => {
    const n = parseInt(value);
    if (!isNaN(n) && n >= 0) setStock(id, n);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track stock and prevent overselling — changes reflect instantly in the customer menu</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => setFilter('all')} className={`kpi-card flex items-center gap-3 text-left transition-all ${filter === 'all' ? 'ring-2 ring-primary' : ''}`}>
            <Package className="w-5 h-5 text-info shrink-0" />
            <div>
              <p className="font-display text-xl font-bold">{tracked.length}</p>
              <p className="text-xs text-muted-foreground">Total Items</p>
            </div>
          </button>
          <button onClick={() => setFilter('low')} className={`kpi-card flex items-center gap-3 text-left border-warning/30 transition-all ${filter === 'low' ? 'ring-2 ring-warning' : ''}`}>
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <div>
              <p className="font-display text-xl font-bold text-warning">{lowStock.length}</p>
              <p className="text-xs text-muted-foreground">Low Stock</p>
            </div>
          </button>
          <button onClick={() => setFilter('out')} className={`kpi-card flex items-center gap-3 text-left border-destructive/30 transition-all ${filter === 'out' ? 'ring-2 ring-destructive' : ''}`}>
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0" />
            <div>
              <p className="font-display text-xl font-bold text-destructive">{outOfStock.length}</p>
              <p className="text-xs text-muted-foreground">Out of Stock</p>
            </div>
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…" className="w-full h-10 pl-9 pr-3 rounded-xl border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors" />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block glass-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Item</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Category</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Stock</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(item => {
                  const pct = item.maxStock ? Math.min(100, (item.stock! / item.maxStock) * 100) : 100;
                  const isLow = item.stock! > 0 && item.stock! <= threshold;
                  const isOut = item.stock === 0;

                  return (
                    <motion.tr key={item.id} layout className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                            {item.thumbnailUrl || item.imageUrl ? (
                              <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <span className="text-base">{item.icon}</span>
                            )}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">{sym}{item.price.toFixed(2)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{item.category}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-center gap-1">
                          <input
                            type="number" min="0" value={item.stock!}
                            onChange={e => handleSetStock(item.id, e.target.value)}
                            className={`w-16 h-7 text-center text-sm font-bold rounded-lg border bg-background focus:outline-none focus:ring-1 focus:ring-primary ${isOut ? 'text-destructive border-destructive/30' : isLow ? 'text-warning border-warning/30' : 'text-foreground border-input'}`}
                          />
                          <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${isOut ? 'bg-destructive' : isLow ? 'bg-warning' : 'bg-success'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isOut
                          ? <span className="status-badge bg-destructive/10 text-destructive">Out of stock</span>
                          : isLow
                          ? <span className="status-badge bg-warning/10 text-warning">Low stock</span>
                          : <span className="status-badge bg-success/10 text-success">In stock</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => handleAdjust(item.id, item.name, -1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><Minus className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleAdjust(item.id, item.name, 1)} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><Plus className="w-3.5 h-3.5" /></button>
                          <button onClick={() => handleRestock(item.id, item.name)} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-primary" title="Restock to max"><RotateCcw className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {visible.map(item => {
            const isLow = item.stock! > 0 && item.stock! <= threshold;
            const isOut = item.stock === 0;
            const pct = item.maxStock ? Math.min(100, (item.stock! / item.maxStock) * 100) : 100;
            return (
              <motion.div key={item.id} layout className="glass-card p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {item.thumbnailUrl || item.imageUrl ? (
                      <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : <span className="text-xl">{item.icon}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.category} · {sym}{item.price.toFixed(2)}</p>
                  </div>
                  {isOut
                    ? <span className="status-badge bg-destructive/10 text-destructive shrink-0">Out</span>
                    : isLow
                    ? <span className="status-badge bg-warning/10 text-warning shrink-0">Low</span>
                    : <span className="status-badge bg-success/10 text-success shrink-0">OK</span>}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Stock: <span className={`font-bold ${isOut ? 'text-destructive' : isLow ? 'text-warning' : 'text-foreground'}`}>{item.stock}</span></span>
                      {item.maxStock && <span>Max: {item.maxStock}</span>}
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full rounded-full ${isOut ? 'bg-destructive' : isLow ? 'bg-warning' : 'bg-success'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleAdjust(item.id, item.name, -1)} className="p-1.5 rounded-lg bg-muted hover:bg-muted/80"><Minus className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleAdjust(item.id, item.name, 1)} className="p-1.5 rounded-lg bg-muted hover:bg-muted/80"><Plus className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleRestock(item.id, item.name)} className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20"><RotateCcw className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {visible.length === 0 && (
          <div className="glass-card p-12 text-center">
            <p className="text-muted-foreground">No items match your filter.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
