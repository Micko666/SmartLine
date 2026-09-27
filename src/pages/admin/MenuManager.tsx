import { useState } from 'react';
import { Plus, Edit2, Archive, Eye, EyeOff, Search, RotateCcw, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { MenuItem, MenuItemStatus } from '@/domain/types';
import { toast } from 'sonner';
import { SEED_CAT_SET, ITEM_STATUS_CONFIG, ViewFilter } from './menu-manager/shared';
import MenuItemForm from './menu-manager/MenuItemForm';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MenuManager() {
  const {
    menuItems, categories, settings, ingredients,
    addMenuItem, updateMenuItem, deleteMenuItem, setMenuItemStatus, addCategory,
  } = useStore(useShallow(s => ({
    menuItems:         s.menuItems,
    categories:        s.categories,
    settings:          s.settings,
    ingredients:       s.ingredients,
    addMenuItem:       s.addMenuItem,
    updateMenuItem:    s.updateMenuItem,
    deleteMenuItem:    s.deleteMenuItem,
    setMenuItemStatus: s.setMenuItemStatus,
    addCategory:       s.addCategory,
  })));

  const [activeCat,   setActiveCat]   = useState('All');
  const [search,      setSearch]      = useState('');
  const [viewFilter,  setViewFilter]  = useState<ViewFilter>('active');
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [showForm,    setShowForm]    = useState(false);
  const sym = settings.currencySymbol;

  // Show seed categories only when they have items in the current filter;
  // always show user-created (non-seed) categories even if empty.
  const populatedCategories = categories.filter(c => {
    const hasItems = menuItems.some(i => i.category === c && (viewFilter === 'all' || i.status === viewFilter));
    return hasItems || !SEED_CAT_SET.has(c);
  });

  const visible = menuItems
    .filter(i => viewFilter === 'all' || i.status === viewFilter)
    .filter(i => activeCat === 'All' || i.category === activeCat)
    .filter(i => {
      const q = search.toLowerCase();
      return !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const handleSave = (data: Omit<MenuItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'salesCount'>) => {
    if (editingItem) {
      updateMenuItem(editingItem.id, data);
      toast.success(`${data.name} updated`);
    } else {
      addMenuItem(data);
      toast.success(`${data.name} added to menu`);
    }
    setShowForm(false);
    setEditingItem(null);
  };

  const handleDelete = (item: MenuItem) => {
    deleteMenuItem(item.id);
    toast.success(`${item.name} archived`);
  };

  const handleToggleStatus = (item: MenuItem) => {
    const next: MenuItemStatus = item.status === 'active' ? 'disabled' : 'active';
    setMenuItemStatus(item.id, next);
    toast.success(`${item.name} ${next === 'active' ? 'enabled' : 'disabled'}`);
  };

  const handleRestore = (item: MenuItem) => {
    setMenuItemStatus(item.id, 'active');
    toast.success(`${item.name} restored`);
  };

  const handleDuplicate = (item: MenuItem) => {
    const { id: _id, createdAt: _c, updatedAt: _u, sortOrder: _s, salesCount: _sc, ...data } = item;
    addMenuItem({ ...data, name: `${item.name} (Copy)`, status: 'disabled' });
    toast.success(`${item.name} duplicated`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Menu Manager</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {menuItems.filter(i => i.status === 'active').length} active items · {categories.length} categories
            </p>
          </div>
          <button
            onClick={() => { setEditingItem(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>

        {/* Status filter + category dropdown */}
        <div className="flex flex-wrap items-center gap-2">
          {(['active', 'disabled', 'archived', 'all'] as ViewFilter[]).map(f => (
            <button
              key={f}
              onClick={() => { setViewFilter(f); setActiveCat('All'); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${viewFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
            >
              {f === 'all' ? 'All statuses' : f}
              <span className="ml-1.5 opacity-70">
                ({menuItems.filter(i => f === 'all' ? true : i.status === f).length})
              </span>
            </button>
          ))}

          <div className="ml-auto">
            <select
              value={activeCat}
              onChange={e => setActiveCat(e.target.value)}
              className="h-9 pl-3 pr-8 rounded-xl border border-input bg-card text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors appearance-none cursor-pointer"
            >
              <option value="All">All categories</option>
              {populatedCategories.map(c => {
                const n = menuItems.filter(i => i.category === c && (viewFilter === 'all' || i.status === viewFilter)).length;
                return <option key={c} value={c}>{c} ({n})</option>;
              })}
            </select>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-input bg-card text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
          />
        </div>

        {/* Items grid */}
        {visible.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <p className="text-muted-foreground">No items found.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {visible.map(item => {
                const cfg    = ITEM_STATUS_CONFIG[item.status];
                const isLow  = item.stock !== null && item.stock > 0 && item.stock <= settings.lowStockThreshold;
                const isOut  = item.stock !== null && item.stock === 0;
                const margin = item.costPerServing != null ? item.price - item.costPerServing : null;
                const marginPct = margin != null && item.price > 0
                  ? Math.round((margin / item.price) * 100) : null;

                return (
                  <motion.div
                    key={item.id} layout
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className={`glass-card p-4 transition-opacity ${item.status !== 'active' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-14 h-14 rounded-xl overflow-hidden bg-muted flex items-center justify-center">
                        {item.imageUrl ? (
                          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                        ) : item.thumbnailUrl ? (
                          <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-2xl">{item.icon}</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-semibold text-sm">{item.name}</h3>
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.badgeClass}`}>{cfg.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>

                        {(item.dietaryTags?.length ?? 0) > 0 && (
                          <div className="flex gap-1 flex-wrap mt-1">
                            {item.dietaryTags!.slice(0, 3).map(t => (
                              <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-700">{t}</span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center gap-3 mt-2 text-xs">
                          <span className="font-semibold text-foreground text-sm">{sym}{item.price.toFixed(2)}</span>
                          {marginPct !== null && (
                            <span className={`font-medium ${marginPct >= 60 ? 'text-success' : marginPct >= 40 ? 'text-warning' : 'text-destructive'}`}>
                              {marginPct}% margin
                            </span>
                          )}
                          <span className="text-muted-foreground">{item.category}</span>
                          {item.stock !== null && (
                            <span className={`font-medium ${isOut ? 'text-destructive' : isLow ? 'text-warning' : 'text-muted-foreground'}`}>
                              {isOut ? '⚠ Out' : isLow ? `⚠ ${item.stock}` : `${item.stock}`} left
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {item.status === 'archived' ? (
                          <button onClick={() => handleRestore(item)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Restore">
                            <RotateCcw className="w-4 h-4 text-primary" />
                          </button>
                        ) : (
                          <>
                            <button onClick={() => handleDuplicate(item)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Duplicate">
                              <Copy className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <button onClick={() => handleToggleStatus(item)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title={item.status === 'active' ? 'Disable' : 'Enable'}>
                              {item.status === 'active' ? <Eye className="w-4 h-4 text-success" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                            </button>
                            <button onClick={() => { setEditingItem(item); setShowForm(true); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Edit">
                              <Edit2 className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <button onClick={() => handleDelete(item)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Archive">
                              <Archive className="w-4 h-4 text-destructive" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        <AnimatePresence>
          {showForm && (
            <MenuItemForm
              item={editingItem}
              categories={categories}
              ingredients={ingredients}
              sym={sym}
              onSave={handleSave}
              onClose={() => { setShowForm(false); setEditingItem(null); }}
              onAddCategory={addCategory}
            />
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  );
}
