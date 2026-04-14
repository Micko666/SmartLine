import { useState } from 'react';
import { Plus, Edit2, Trash2, X, FlaskConical, TrendingDown, Check, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { Ingredient, MenuItem } from '@/domain/types';
import { toast } from 'sonner';

const UNIT_OPTIONS = [
  // Weight
  'g', 'kg', 'oz', 'lb',
  // Volume
  'ml', 'l', 'tbsp', 'tsp', 'cup',
  // Count / portion
  'pcs', 'slice', 'portion', 'scoop', 'pinch', 'clove', 'sheet',
  // Packaging
  'bunch', 'can', 'bottle', 'sachet', 'fillet', 'sprig',
];

// ─── Kitchen unit helpers (mirrors MenuManager) ───────────────────────────────

function kitchenUnitsFor(purchaseUnit: string): Array<{ label: string; toPurchase: number }> {
  if (purchaseUnit === 'kg') return [{ label: 'g', toPurchase: 0.001 }, { label: 'kg', toPurchase: 1 }];
  if (purchaseUnit === 'l')  return [{ label: 'ml', toPurchase: 0.001 }, { label: 'l', toPurchase: 1 }];
  return [{ label: purchaseUnit, toPurchase: 1 }];
}

function defaultKitchenEntry(purchaseUnit: string): { unit: string; qty: number } {
  if (purchaseUnit === 'kg') return { unit: 'g', qty: 100 };
  if (purchaseUnit === 'l')  return { unit: 'ml', qty: 100 };
  return { unit: purchaseUnit, qty: 1 };
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Ingredients() {
  const { ingredients, menuItems, settings, addIngredient, updateIngredient, deleteIngredient, updateMenuItem } = useStore(
    useShallow(s => ({
      ingredients:     s.ingredients,
      menuItems:       s.menuItems,
      settings:        s.settings,
      addIngredient:   s.addIngredient,
      updateIngredient: s.updateIngredient,
      deleteIngredient: s.deleteIngredient,
      updateMenuItem:   s.updateMenuItem,
    })),
  );

  const [showForm,          setShowForm]          = useState(false);
  const [editingId,         setEditingId]         = useState<string | null>(null);
  const [confirmDel,        setConfirmDel]        = useState<string | null>(null);
  const [linkingIngredient, setLinkingIngredient] = useState<Ingredient | null>(null);

  const sym = settings.currencySymbol;

  const usageCount = (ingId: string) =>
    menuItems.filter(m => (m.recipe ?? []).some(r => r.ingredientId === ingId)).length;

  const handleDelete = (id: string) => {
    deleteIngredient(id);
    setConfirmDel(null);
    toast.success('Ingredient removed');
  };

  const sorted = [...ingredients].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Ingredients</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {ingredients.length} ingredient{ingredients.length !== 1 ? 's' : ''} · track cost per serving across your menu
            </p>
          </div>
          <button
            onClick={() => { setEditingId(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Add Ingredient
          </button>
        </div>

        {/* KPI cards */}
        {ingredients.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total Ingredients', value: String(ingredients.length), icon: FlaskConical, color: 'text-primary' },
              { label: 'Linked to Menu', value: String(ingredients.filter(i => usageCount(i.id) > 0).length), icon: TrendingDown, color: 'text-success' },
              {
                label: 'Avg Cost / Item',
                value: (() => {
                  const itemsWithCost = menuItems.filter(m => m.costPerServing != null);
                  if (!itemsWithCost.length) return '—';
                  const avg = itemsWithCost.reduce((s, m) => s + m.costPerServing!, 0) / itemsWithCost.length;
                  return `${sym}${avg.toFixed(2)}`;
                })(),
                icon: TrendingDown, color: 'text-info',
              },
              {
                label: 'Items with Cost Set',
                value: `${menuItems.filter(m => m.costPerServing != null).length}/${menuItems.filter(m => m.status === 'active').length}`,
                icon: Check, color: 'text-warning',
              },
            ].map(kpi => (
              <div key={kpi.label} className="kpi-card">
                <kpi.icon className={`w-5 h-5 ${kpi.color} mb-3`} />
                <p className="font-display text-xl font-bold">{kpi.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Ingredients list */}
        {ingredients.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <FlaskConical className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold mb-1">No ingredients yet</p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Add ingredients to track your food cost and build recipes for menu items.
            </p>
          </div>
        ) : (
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wide">Ingredient</th>
                    <th className="text-left px-4 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wide">Unit</th>
                    <th className="text-right px-4 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wide">Cost / Unit</th>
                    <th className="text-right px-4 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Stock</th>
                    <th className="text-right px-4 py-3 font-medium text-xs text-muted-foreground uppercase tracking-wide hidden md:table-cell">Used In</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {sorted.map(ing => {
                      const uses = usageCount(ing.id);
                      return (
                        <motion.tr
                          key={ing.id} layout
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                          className="border-b border-border/50 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-3 font-medium">{ing.name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{ing.unit}</td>
                          <td className="px-4 py-3 text-right font-semibold">{sym}{ing.costPerUnit.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-muted-foreground hidden sm:table-cell">
                            {ing.stock != null ? `${ing.stock} ${ing.unit}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right hidden md:table-cell">
                            {uses > 0 ? (
                              <span className="text-primary font-medium">{uses} item{uses !== 1 ? 's' : ''}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">not linked</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => { setEditingId(ing.id); setShowForm(true); }}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
                              </button>
                              {confirmDel === ing.id ? (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => handleDelete(ing.id)} className="px-2 py-0.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium">Delete</button>
                                  <button onClick={() => setConfirmDel(null)} className="p-1 rounded-lg hover:bg-muted transition-colors"><X className="w-3 h-3" /></button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDel(ing.id)}
                                  className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors" title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                </button>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Ingredient form modal */}
        <AnimatePresence>
          {showForm && (
            <IngredientForm
              ingredient={editingId ? ingredients.find(i => i.id === editingId) ?? null : null}
              sym={sym}
              onSave={(data, isNew) => {
                if (editingId) {
                  updateIngredient(editingId, data);
                  toast.success(`${data.name} updated`);
                  setShowForm(false);
                  setEditingId(null);
                } else {
                  const created = addIngredient(data);
                  toast.success(`${data.name} added`);
                  setShowForm(false);
                  // Only prompt to link if there are active menu items
                  if (isNew && menuItems.filter(m => m.status === 'active').length > 0) {
                    setLinkingIngredient(created);
                  }
                }
              }}
              onClose={() => { setShowForm(false); setEditingId(null); }}
            />
          )}
        </AnimatePresence>

        {/* Link-to-items panel */}
        <AnimatePresence>
          {linkingIngredient && (
            <LinkToItemsPanel
              ingredient={linkingIngredient}
              menuItems={menuItems}
              sym={sym}
              onLink={(itemId, storedQty) => {
                const item = menuItems.find(m => m.id === itemId);
                if (!item) return;
                const existingRecipe = item.recipe ?? [];
                const alreadyIn = existingRecipe.findIndex(r => r.ingredientId === linkingIngredient.id);
                const newRecipe = alreadyIn >= 0
                  ? existingRecipe.map((r, i) => i === alreadyIn ? { ...r, quantity: storedQty } : r)
                  : [...existingRecipe, { ingredientId: linkingIngredient.id, quantity: storedQty }];
                // Recalculate cost — we only have access to this ingredient's cost here,
                // so pass the full updated recipe and let updateMenuItem handle it via store
                updateMenuItem(itemId, { recipe: newRecipe });
              }}
              onClose={() => setLinkingIngredient(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </DashboardLayout>
  );
}

// ─── Ingredient Form ──────────────────────────────────────────────────────────

type IngFormData = Omit<Ingredient, 'id' | 'createdAt' | 'updatedAt'>;

function IngredientForm({ ingredient, sym, onSave, onClose }: {
  ingredient: Ingredient | null;
  sym: string;
  onSave: (data: IngFormData, isNew: boolean) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<IngFormData>(ingredient ? {
    name: ingredient.name, unit: ingredient.unit,
    costPerUnit: ingredient.costPerUnit, stock: ingredient.stock,
  } : { name: '', unit: 'g', costPerUnit: 0, stock: undefined });

  const [errors, setErrors] = useState<Record<string, string>>({});

  const up = <K extends keyof IngFormData>(k: K, v: IngFormData[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k as string]) setErrors(e => ({ ...e, [k as string]: '' }));
  };

  const handleSubmit = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim())     e.name        = 'Name is required';
    if (form.costPerUnit < 0)  e.costPerUnit = 'Cost cannot be negative';
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave(form, !ingredient);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28 }} onClick={e => e.stopPropagation()}
        className="glass-card-solid w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-lg font-bold">{ingredient ? 'Edit Ingredient' : 'Add Ingredient'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium mb-1 block">Name *</label>
            <input
              value={form.name} onChange={e => up('name', e.target.value)}
              placeholder="e.g. Mozzarella, Bread Flour"
              autoFocus
              className={`w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 ${errors.name ? 'border-destructive' : 'border-input'}`}
            />
            {errors.name && <p className="text-xs text-destructive mt-0.5">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Unit</label>
              <select
                value={form.unit} onChange={e => up('unit', e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
              >
                {UNIT_OPTIONS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Cost per {form.unit} ({sym}) *</label>
              <input
                type="number" step="0.01" min="0" value={form.costPerUnit}
                onChange={e => up('costPerUnit', parseFloat(e.target.value) || 0)}
                className={`w-full h-10 px-3 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 ${errors.costPerUnit ? 'border-destructive' : 'border-input'}`}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium mb-1 block">Current Stock <span className="text-muted-foreground">(optional)</span></label>
            <input
              type="number" min="0" value={form.stock ?? ''}
              onChange={e => up('stock', e.target.value === '' ? undefined : Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="Leave blank if not tracking"
              className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            {ingredient ? 'Save Changes' : 'Add Ingredient'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Link-to-Items Panel ──────────────────────────────────────────────────────

function LinkToItemsPanel({ ingredient, menuItems, sym, onLink, onClose }: {
  ingredient: Ingredient;
  menuItems: MenuItem[];
  sym: string;
  onLink: (itemId: string, storedQty: number) => void;
  onClose: () => void;
}) {
  const [search,      setSearch]      = useState('');
  const [expandedId,  setExpandedId]  = useState<string | null>(null);
  const [linked,      setLinked]      = useState<Set<string>>(new Set());

  // Per-item entry state: { qty, unit }
  const [entries, setEntries] = useState<Record<string, { qty: number; unit: string }>>({});

  const activeItems = menuItems.filter(m => m.status === 'active');

  const filtered = activeItems.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.category.toLowerCase().includes(search.toLowerCase())
  );

  const getEntry = (itemId: string) => {
    if (entries[itemId]) return entries[itemId];
    const def = defaultKitchenEntry(ingredient.unit);
    return def;
  };

  const setEntry = (itemId: string, update: Partial<{ qty: number; unit: string }>) => {
    const cur = getEntry(itemId);
    setEntries(e => ({ ...e, [itemId]: { ...cur, ...update } }));
  };

  const alreadyInRecipe = (item: MenuItem) =>
    (item.recipe ?? []).some(r => r.ingredientId === ingredient.id);

  const handleLink = (item: MenuItem) => {
    const entry = getEntry(item.id);
    const units = kitchenUnitsFor(ingredient.unit);
    const factor = units.find(u => u.label === entry.unit)?.toPurchase ?? 1;
    const storedQty = entry.qty * factor;
    onLink(item.id, storedQty);
    setLinked(s => new Set([...s, item.id]));
    setExpandedId(null);
    toast.success(`${ingredient.name} added to ${item.name}`);
  };

  const kitchenUnits = kitchenUnitsFor(ingredient.unit);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28 }} onClick={e => e.stopPropagation()}
        className="glass-card-solid w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold">Add to menu items?</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Which dishes use <span className="font-semibold text-foreground">{ingredient.name}</span>?
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search items…"
              autoFocus
              className="w-full h-9 pl-9 pr-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </div>

        {/* Items list */}
        <div className="overflow-y-auto flex-1 py-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No items found.</p>
          ) : (
            filtered.map(item => {
              const isExpanded  = expandedId === item.id;
              const isLinked    = linked.has(item.id);
              const wasInRecipe = alreadyInRecipe(item);
              const entry       = getEntry(item.id);
              const factor      = kitchenUnits.find(u => u.label === entry.unit)?.toPurchase ?? 1;
              const previewCost = ingredient.costPerUnit * entry.qty * factor;

              return (
                <div key={item.id} className="border-b border-border/50 last:border-0">
                  {/* Item row */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                  >
                    {/* Thumbnail */}
                    <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                      {item.imageUrl || item.thumbnailUrl ? (
                        <img src={item.imageUrl || item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base">{item.icon}</span>
                      )}
                    </div>

                    {/* Name + category */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.category}</p>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0">
                      {isLinked ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-success">
                          <Check className="w-3.5 h-3.5" /> Added
                        </span>
                      ) : wasInRecipe ? (
                        <span className="text-xs text-muted-foreground">already linked</span>
                      ) : (
                        isExpanded
                          ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          : <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </button>

                  {/* Expanded: quantity entry */}
                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        key="entry"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-3 pt-1 flex items-center gap-2 bg-muted/20">
                          <span className="text-xs text-muted-foreground shrink-0">Qty per serving:</span>
                          <input
                            type="number" min="0.01" step="any" value={entry.qty}
                            onChange={e => setEntry(item.id, { qty: parseFloat(e.target.value) || 0.01 })}
                            onClick={e => e.stopPropagation()}
                            className="w-20 h-8 px-2 rounded-lg border border-primary bg-background text-sm font-semibold text-right focus:outline-none focus:ring-1 focus:ring-ring/20"
                          />
                          {kitchenUnits.length > 1 ? (
                            <select
                              value={entry.unit}
                              onChange={e => { e.stopPropagation(); setEntry(item.id, { unit: e.target.value }); }}
                              onClick={e => e.stopPropagation()}
                              className="h-8 px-2 rounded-lg border border-input bg-background text-sm font-medium focus:outline-none"
                            >
                              {kitchenUnits.map(u => <option key={u.label} value={u.label}>{u.label}</option>)}
                            </select>
                          ) : (
                            <span className="h-8 flex items-center px-2 rounded-lg bg-muted text-sm font-medium text-muted-foreground">
                              {kitchenUnits[0].label}
                            </span>
                          )}
                          <span className="text-xs font-semibold text-success shrink-0">= {sym}{previewCost.toFixed(2)}</span>
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); handleLink(item); }}
                            className="ml-auto px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity shrink-0"
                          >
                            {wasInRecipe ? 'Update' : 'Add'}
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {linked.size > 0 ? `${linked.size} item${linked.size !== 1 ? 's' : ''} linked` : 'Click an item to set the quantity'}
          </p>
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
