import { useState, useRef } from 'react';
import {
  Plus, Edit2, Archive, Eye, EyeOff, Search, RotateCcw,
  X, Copy, ChevronDown, ChevronUp, Flame, Leaf, Trash2,
  FlaskConical, ImagePlus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { MenuItem, MenuItemStatus, Modifier, ModifierOption, Ingredient, RecipeIngredient } from '@/domain/types';
import { toast } from 'sonner';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLERGEN_LIST = [
  { id: 'gluten',    label: 'Gluten',    emoji: '🌾' },
  { id: 'dairy',     label: 'Dairy',     emoji: '🥛' },
  { id: 'eggs',      label: 'Eggs',      emoji: '🥚' },
  { id: 'nuts',      label: 'Tree Nuts', emoji: '🌰' },
  { id: 'peanuts',   label: 'Peanuts',   emoji: '🥜' },
  { id: 'soy',       label: 'Soy',       emoji: '🫘' },
  { id: 'shellfish', label: 'Shellfish', emoji: '🦞' },
  { id: 'fish',      label: 'Fish',      emoji: '🐟' },
  { id: 'sesame',    label: 'Sesame',    emoji: '🫙' },
];

const DIETARY_LIST = [
  { id: 'vegetarian', label: 'Vegetarian', color: 'bg-green-500/10 text-green-700 border-green-200' },
  { id: 'vegan',      label: 'Vegan',      color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200' },
  { id: 'gluten-free',label: 'Gluten-Free',color: 'bg-amber-500/10 text-amber-700 border-amber-200' },
  { id: 'dairy-free', label: 'Dairy-Free', color: 'bg-blue-500/10 text-blue-700 border-blue-200' },
  { id: 'halal',      label: 'Halal',      color: 'bg-teal-500/10 text-teal-700 border-teal-200' },
  { id: 'kosher',     label: 'Kosher',     color: 'bg-purple-500/10 text-purple-700 border-purple-200' },
  { id: 'spicy',      label: 'Spicy 🌶',   color: 'bg-red-500/10 text-red-700 border-red-200' },
];

const ITEM_STATUS_CONFIG: Record<MenuItemStatus, { label: string; badgeClass: string }> = {
  active:   { label: 'Active',   badgeClass: 'bg-success/10 text-success' },
  disabled: { label: 'Disabled', badgeClass: 'bg-warning/10 text-warning' },
  archived: { label: 'Archived', badgeClass: 'bg-muted text-muted-foreground' },
};

type ViewFilter = 'active' | 'disabled' | 'archived' | 'all';

// ─── Kitchen unit helpers ─────────────────────────────────────────────────────

/** For a given purchase/storage unit, return the kitchen-friendly unit options with conversion factors. */
function kitchenUnitsFor(purchaseUnit: string): Array<{ label: string; toPurchase: number }> {
  if (purchaseUnit === 'kg') return [{ label: 'g', toPurchase: 0.001 }, { label: 'kg', toPurchase: 1 }];
  if (purchaseUnit === 'l')  return [{ label: 'ml', toPurchase: 0.001 }, { label: 'l', toPurchase: 1 }];
  return [{ label: purchaseUnit, toPurchase: 1 }];
}

/** Default kitchen quantity and unit when adding an ingredient to a recipe. */
function defaultKitchenEntry(purchaseUnit: string): { unit: string; qty: number } {
  if (purchaseUnit === 'kg') return { unit: 'g', qty: 100 };
  if (purchaseUnit === 'l')  return { unit: 'ml', qty: 100 };
  return { unit: purchaseUnit, qty: 1 };
}

/** Convert a stored quantity (in purchase unit) to a kitchen-friendly display value. */
function toDisplayQty(storedQty: number, purchaseUnit: string): { qty: number; unit: string } {
  if (purchaseUnit === 'kg' && storedQty < 1) return { qty: Math.round(storedQty * 1000), unit: 'g' };
  if (purchaseUnit === 'l'  && storedQty < 1) return { qty: Math.round(storedQty * 1000), unit: 'ml' };
  const val = storedQty < 10
    ? parseFloat(storedQty.toFixed(3))
    : parseFloat(storedQty.toFixed(1));
  return { qty: val, unit: purchaseUnit };
}

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

  // Show all created categories; count reflects current status filter
  const populatedCategories = categories;

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

        {/* Status filter + category dropdown — one unified toolbar */}
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

          {/* Category dropdown — only lists categories with items in the current view */}
          <div className="ml-auto flex items-center gap-2">
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

// ─── Collapsible Section ──────────────────────────────────────────────────────

function SectionToggle({ title, badge, open, onToggle, children }: {
  title: string;
  badge?: string | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
      >
        <span className="text-sm font-semibold">{title}</span>
        <div className="flex items-center gap-2 min-w-0">
          {badge && (
            <span className="text-xs text-muted-foreground truncate max-w-[220px]">{badge}</span>
          )}
          {open
            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          }
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-3 border-t border-border">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Menu Item Form ───────────────────────────────────────────────────────────

type FormData = Omit<MenuItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'salesCount'>;

function MenuItemForm({ item, categories, ingredients, sym, onSave, onClose, onAddCategory }: {
  item: MenuItem | null;
  categories: string[];
  ingredients: Ingredient[];
  sym: string;
  onSave: (data: FormData) => void;
  onClose: () => void;
  onAddCategory: (name: string) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState<FormData>(() => item ? {
    name:           item.name,
    description:    item.description,
    category:       item.category,
    price:          item.price,
    prepTime:       item.prepTime,
    stock:          item.stock,
    maxStock:       item.maxStock,
    status:         item.status,
    icon:           item.icon,
    imageUrl:       item.imageUrl,
    thumbnailUrl:   item.thumbnailUrl,
    tags:           item.tags,
    allergens:      item.allergens   ?? [],
    dietaryTags:    item.dietaryTags ?? [],
    calories:       item.calories,
    costPerServing: item.costPerServing,
    recipe:         item.recipe      ?? [],
    modifiers:      item.modifiers,
  } : {
    name: '', description: '', category: categories[0] ?? '', price: 0, prepTime: 10,
    stock: null, maxStock: null, status: 'active', icon: '🍽️', imageUrl: '', thumbnailUrl: '',
    tags: [], allergens: [], dietaryTags: [], calories: undefined, costPerServing: undefined,
    recipe: [], modifiers: [],
  });

  // Collapsible sections — open if item already has content in that section
  const [openSections, setOpenSections] = useState({
    customizations: (item?.modifiers?.length ?? 0) > 0,
    recipe:         (item?.recipe?.length ?? 0) > 0,
    dietary:        (item?.allergens?.length ?? 0) > 0
                    || (item?.dietaryTags?.length ?? 0) > 0
                    || !!item?.calories,
  });
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections(s => ({ ...s, [key]: !s[key] }));

  // Category creation
  const [newCatMode, setNewCatMode] = useState(false);
  const [newCatName, setNewCatName] = useState('');

  // Recipe add state
  const [recipeIngId,      setRecipeIngId]      = useState('');
  const [recipeKitchenQty, setRecipeKitchenQty] = useState(100);
  const [recipeKitchenUnit,setRecipeKitchenUnit] = useState('g');

  const imageRef = useRef<HTMLInputElement>(null);

  const up = <K extends keyof FormData>(key: K, val: FormData[K]) => {
    setForm(f => ({ ...f, [key]: val }));
    if (errors[key as string]) setErrors(e => ({ ...e, [key as string]: '' }));
  };

  const handleImageFile = (file: File) => {
    if (file.size > 500 * 1024) toast.warning('Image over 500KB — consider compressing it.');
    const reader = new FileReader();
    reader.onload = e => {
      const url = e.target?.result as string ?? '';
      setForm(f => ({ ...f, imageUrl: url, thumbnailUrl: url }));
    };
    reader.readAsDataURL(file);
  };

  // ── Recipe helpers ──────────────────────────────────────────────────────────

  const applyRecipe = (newRecipe: RecipeIngredient[]) => {
    const cost = newRecipe.reduce((sum, ri) => {
      const ing = ingredients.find(i => i.id === ri.ingredientId);
      return sum + (ing ? ing.costPerUnit * ri.quantity : 0);
    }, 0);
    setForm(f => ({
      ...f,
      recipe: newRecipe,
      costPerServing: newRecipe.length > 0 ? parseFloat(cost.toFixed(4)) : undefined,
    }));
  };

  const selectRecipeIng = (ingId: string) => {
    if (!ingId) { setRecipeIngId(''); return; }
    const ing = ingredients.find(i => i.id === ingId)!;
    const def = defaultKitchenEntry(ing.unit);
    setRecipeIngId(ingId);
    setRecipeKitchenUnit(def.unit);
    setRecipeKitchenQty(def.qty);
  };

  const addRecipeItem = () => {
    if (!recipeIngId || recipeKitchenQty <= 0) return;
    const ing = ingredients.find(i => i.id === recipeIngId)!;
    const units = kitchenUnitsFor(ing.unit);
    const factor = units.find(u => u.label === recipeKitchenUnit)?.toPurchase ?? 1;
    const storedQty = recipeKitchenQty * factor;
    const cur = form.recipe ?? [];
    const existing = cur.findIndex(r => r.ingredientId === recipeIngId);
    const updated = existing >= 0
      ? cur.map((r, i) => i === existing ? { ...r, quantity: storedQty } : r)
      : [...cur, { ingredientId: recipeIngId, quantity: storedQty }];
    applyRecipe(updated);
    setRecipeIngId('');
    const firstIng = ingredients[0];
    if (firstIng) {
      const def = defaultKitchenEntry(firstIng.unit);
      setRecipeKitchenQty(def.qty);
      setRecipeKitchenUnit(def.unit);
    }
  };

  const removeRecipeItem = (ingId: string) =>
    applyRecipe((form.recipe ?? []).filter(r => r.ingredientId !== ingId));

  const updateRecipeDisplayQty = (ingId: string, displayQty: number, displayUnit: string, purchaseUnit: string) => {
    const units = kitchenUnitsFor(purchaseUnit);
    const factor = units.find(u => u.label === displayUnit)?.toPurchase ?? 1;
    applyRecipe((form.recipe ?? []).map(r =>
      r.ingredientId === ingId ? { ...r, quantity: displayQty * factor } : r
    ));
  };

  // ── Category helpers ────────────────────────────────────────────────────────

  const handleAddCategory = () => {
    const name = newCatName.trim();
    if (!name) return;
    onAddCategory(name);
    up('category', name);
    setNewCatMode(false);
    setNewCatName('');
  };

  // Ensure currently-selected category appears even if removed from the list
  const allCats = categories.includes(form.category)
    ? categories
    : form.category
      ? [form.category, ...categories]
      : categories;

  // ── Allergen / dietary helpers ──────────────────────────────────────────────

  const toggleAllergen = (id: string) => {
    const cur = form.allergens ?? [];
    up('allergens', cur.includes(id) ? cur.filter(a => a !== id) : [...cur, id]);
  };

  const toggleDietary = (id: string) => {
    const cur = form.dietaryTags ?? [];
    up('dietaryTags', cur.includes(id) ? cur.filter(d => d !== id) : [...cur, id]);
  };

  // ── Modifier helpers ────────────────────────────────────────────────────────

  const addModifier = () => {
    const mod: Modifier = {
      id: `mod-${Date.now()}`,
      name: 'New Option Group',
      required: false,
      maxSelections: 1,
      options: [],
    };
    up('modifiers', [...form.modifiers, mod]);
  };

  const removeModifier = (modId: string) =>
    up('modifiers', form.modifiers.filter(m => m.id !== modId));

  const updateModifier = (modId: string, changes: Partial<Modifier>) =>
    up('modifiers', form.modifiers.map(m => m.id === modId ? { ...m, ...changes } : m));

  const addOption = (modId: string) => {
    const opt: ModifierOption = { id: `opt-${Date.now()}`, name: 'New Option', priceAdjustment: 0 };
    up('modifiers', form.modifiers.map(m =>
      m.id === modId ? { ...m, options: [...m.options, opt] } : m));
  };

  const removeOption = (modId: string, optId: string) =>
    up('modifiers', form.modifiers.map(m =>
      m.id === modId ? { ...m, options: m.options.filter(o => o.id !== optId) } : m));

  const updateOption = (modId: string, optId: string, changes: Partial<ModifierOption>) =>
    up('modifiers', form.modifiers.map(m =>
      m.id === modId
        ? { ...m, options: m.options.map(o => o.id === optId ? { ...o, ...changes } : o) }
        : m));

  // ── Section badges (collapsed previews) ────────────────────────────────────

  const modifiersBadge = form.modifiers.length > 0
    ? `${form.modifiers.length} option group${form.modifiers.length !== 1 ? 's' : ''}`
    : 'No customizations';

  const recipeBadge = (form.recipe?.length ?? 0) > 0
    ? `${form.recipe!.length} ingredient${form.recipe!.length !== 1 ? 's' : ''} · ${sym}${(form.costPerServing ?? 0).toFixed(2)}/serving`
    : (form.costPerServing != null ? `${sym}${form.costPerServing.toFixed(2)}/serving` : 'No recipe yet');

  const dietaryBadge = (() => {
    const parts: string[] = [];
    if (form.dietaryTags?.length) parts.push(...form.dietaryTags.slice(0, 2).map(t => t.charAt(0).toUpperCase() + t.slice(1)));
    if (form.allergens?.length) parts.push(`${form.allergens.length} allergen${form.allergens.length !== 1 ? 's' : ''}`);
    if (form.calories) parts.push(`${form.calories} kcal`);
    return parts.length ? parts.join(' · ') : 'Not set';
  })();

  // ── Validate & submit ───────────────────────────────────────────────────────

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim())               e.name     = 'Name is required';
    if (form.price < 0)                  e.price    = 'Cannot be negative';
    if (form.prepTime < 0)               e.prepTime = 'Cannot be negative';
    if (form.stock !== null && form.stock < 0) e.stock = 'Cannot be negative';
    return e;
  };

  const handleSubmit = () => {
    const e = validate();
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    onSave(form);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  // Recipe ingredient currently being added
  const addingIng = recipeIngId ? ingredients.find(i => i.id === recipeIngId) : null;
  const addingUnits = addingIng ? kitchenUnitsFor(addingIng.unit) : [];
  const addingFactor = addingUnits.find(u => u.label === recipeKitchenUnit)?.toPurchase ?? 1;
  const addingCost = addingIng ? addingIng.costPerUnit * (recipeKitchenQty * addingFactor) : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28 }} onClick={e => e.stopPropagation()}
        className="glass-card-solid w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl"
      >
        {/* ── Header ── */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm z-10 px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">{item ? 'Edit Item' : 'New Menu Item'}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5">

          {/* ── 1. Photo + Name + Description ── */}
          <div className="flex gap-4">
            {/* Photo / Emoji area */}
            <div className="shrink-0 flex flex-col items-center gap-1.5">
              <div
                className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl border-2 border-dashed border-input bg-muted/40 flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors overflow-hidden relative group"
                onClick={() => imageRef.current?.click()}
              >
                {form.imageUrl ? (
                  <>
                    <img src={form.imageUrl} alt="preview" className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <ImagePlus className="w-5 h-5 text-white" />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-1 px-2 text-center">
                    <span className="text-3xl leading-none">{form.icon || '🍽️'}</span>
                    <span className="text-[10px] text-muted-foreground mt-1">Add photo</span>
                  </div>
                )}
              </div>
              <input ref={imageRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }} />
              {form.imageUrl ? (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, imageUrl: '', thumbnailUrl: '' }))}
                  className="text-[10px] text-destructive hover:underline"
                >Remove photo</button>
              ) : (
                <input
                  value={form.icon}
                  onChange={e => up('icon', e.target.value)}
                  placeholder="🍽️"
                  title="Emoji shown when no photo"
                  className="w-full text-center text-base h-7 rounded-lg border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring/20 px-1"
                />
              )}
            </div>

            {/* Name + Description */}
            <div className="flex-1 min-w-0 flex flex-col gap-2.5">
              <div>
                <input
                  value={form.name}
                  onChange={e => up('name', e.target.value)}
                  placeholder="Item name"
                  className={`w-full h-11 px-3 rounded-xl border text-base font-semibold bg-background focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors ${errors.name ? 'border-destructive' : 'border-input'}`}
                />
                {errors.name && <p className="text-xs text-destructive mt-0.5">{errors.name}</p>}
              </div>
              <textarea
                value={form.description}
                onChange={e => up('description', e.target.value)}
                rows={3}
                placeholder="Short description for customers (optional)"
                className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors"
              />
            </div>
          </div>

          {/* ── 2. Price · Prep · Status ── */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Price ({sym})</label>
              <input
                type="number" step="0.10" min="0" value={form.price}
                onChange={e => up('price', parseFloat(e.target.value) || 0)}
                className={`w-full h-10 px-3 rounded-xl border bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors ${errors.price ? 'border-destructive' : 'border-input'}`}
              />
              {errors.price && <p className="text-xs text-destructive mt-0.5">{errors.price}</p>}
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Prep time</label>
              <div className="relative">
                <input
                  type="number" min="0" value={form.prepTime}
                  onChange={e => up('prepTime', parseInt(e.target.value) || 0)}
                  className="w-full h-10 px-3 pr-10 rounded-xl border border-input bg-background text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">min</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Status</label>
              <div className="flex h-10 p-1 bg-muted rounded-xl gap-0.5">
                {(['active', 'disabled'] as const).map(s => (
                  <button
                    key={s} type="button"
                    onClick={() => up('status', s)}
                    className={`flex-1 rounded-lg text-xs font-medium transition-all capitalize ${form.status === s ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >{s === 'active' ? 'Active' : 'Off'}</button>
                ))}
              </div>
            </div>
          </div>

          {/* ── 3. Category ── */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-2 block">Category</label>
            {newCatMode ? (
              <div className="flex gap-1.5">
                <input
                  value={newCatName} onChange={e => setNewCatName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } if (e.key === 'Escape') { setNewCatMode(false); setNewCatName(''); } }}
                  placeholder="New category name"
                  autoFocus
                  className="flex-1 h-9 px-3 rounded-full border border-primary bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <button onClick={handleAddCategory} className="px-4 h-9 rounded-full bg-primary text-primary-foreground text-xs font-medium hover:opacity-90">Add</button>
                <button onClick={() => { setNewCatMode(false); setNewCatName(''); }} className="p-2 h-9 rounded-full bg-muted hover:bg-muted/80 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allCats.map(c => (
                  <button
                    key={c} type="button"
                    onClick={() => up('category', c)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all ${
                      form.category === c
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                    }`}
                  >{c}</button>
                ))}
                <button
                  type="button" onClick={() => setNewCatMode(true)}
                  className="px-3.5 py-1.5 rounded-full text-xs font-medium border border-dashed border-primary/40 text-primary hover:bg-primary/5 transition-colors"
                >+ New</button>
              </div>
            )}
          </div>

          {/* ── 4. Stock ── */}
          <div className="flex items-center gap-3 py-0.5">
            <button
              type="button"
              onClick={() => up('stock', form.stock === null ? 10 : null)}
              className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${form.stock !== null ? 'bg-primary' : 'bg-muted-foreground/30'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.stock !== null ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-foreground">Track stock</span>
            {form.stock !== null && (
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="number" min="0" value={form.stock}
                  onChange={e => up('stock', Math.max(0, parseInt(e.target.value) || 0))}
                  className={`w-20 h-8 px-2 rounded-lg border bg-background text-sm text-right font-semibold focus:outline-none focus:ring-1 focus:ring-ring/20 ${errors.stock ? 'border-destructive' : 'border-input'}`}
                />
                <span className="text-xs text-muted-foreground">units</span>
              </div>
            )}
            {form.stock === null && (
              <span className="ml-auto text-xs text-muted-foreground">Unlimited</span>
            )}
          </div>

          {/* ── 5. Customizations (Modifiers) ── */}
          <SectionToggle
            title="Customizations"
            badge={modifiersBadge}
            open={openSections.customizations}
            onToggle={() => toggleSection('customizations')}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Let customers pick sizes, extras, or substitutions.</p>
                <button
                  type="button" onClick={addModifier}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Group
                </button>
              </div>
              {form.modifiers.length === 0 ? (
                <div className="border-2 border-dashed border-border rounded-xl p-6 text-center">
                  <p className="text-sm text-muted-foreground">No option groups yet.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Add groups like "Size", "Extras", or "Sauce choice".</p>
                </div>
              ) : (
                form.modifiers.map(mod => (
                  <ModifierGroupEditor
                    key={mod.id}
                    mod={mod}
                    sym={sym}
                    onUpdate={changes => updateModifier(mod.id, changes)}
                    onDelete={() => removeModifier(mod.id)}
                    onAddOption={() => addOption(mod.id)}
                    onRemoveOption={optId => removeOption(mod.id, optId)}
                    onUpdateOption={(optId, changes) => updateOption(mod.id, optId, changes)}
                  />
                ))
              )}
            </div>
          </SectionToggle>

          {/* ── 6. Recipe & Cost ── */}
          <SectionToggle
            title="Recipe & Cost"
            badge={recipeBadge}
            open={openSections.recipe}
            onToggle={() => toggleSection('recipe')}
          >
            <div className="space-y-3">
              {ingredients.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 border border-dashed border-border rounded-xl text-center">
                  No ingredients yet — add them in the <span className="font-medium">Ingredients</span> page first.
                </p>
              ) : (
                <>
                  {/* Add ingredient row */}
                  <div className="space-y-2">
                    <select
                      value={recipeIngId}
                      onChange={e => selectRecipeIng(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 transition-colors"
                    >
                      <option value="">Pick an ingredient to add…</option>
                      {ingredients
                        .filter(i => !(form.recipe ?? []).some(r => r.ingredientId === i.id))
                        .map(i => (
                          <option key={i.id} value={i.id}>{i.name}</option>
                        ))}
                    </select>

                    {addingIng && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min="0.01" step="any" value={recipeKitchenQty}
                          onChange={e => setRecipeKitchenQty(parseFloat(e.target.value) || 0)}
                          className="w-24 h-10 px-3 rounded-xl border border-primary bg-background text-sm font-semibold text-right focus:outline-none focus:ring-2 focus:ring-ring/20"
                        />
                        {addingUnits.length > 1 ? (
                          <select
                            value={recipeKitchenUnit}
                            onChange={e => setRecipeKitchenUnit(e.target.value)}
                            className="h-10 px-2 rounded-xl border border-input bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-ring/20"
                          >
                            {addingUnits.map(u => <option key={u.label} value={u.label}>{u.label}</option>)}
                          </select>
                        ) : (
                          <span className="px-3 h-10 flex items-center text-sm font-medium text-muted-foreground bg-muted rounded-xl">{addingUnits[0]?.label}</span>
                        )}
                        <span className="text-xs font-semibold text-success shrink-0">= {sym}{addingCost.toFixed(2)}</span>
                        <button
                          type="button" onClick={addRecipeItem}
                          className="ml-auto px-4 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity shrink-0"
                        >Add</button>
                      </div>
                    )}
                  </div>

                  {/* Recipe ingredient list */}
                  {(form.recipe ?? []).length > 0 && (
                    <div className="rounded-xl border border-border overflow-hidden">
                      {(form.recipe ?? []).map(ri => {
                        const ing = ingredients.find(i => i.id === ri.ingredientId);
                        if (!ing) return null;
                        const { qty: dispQty, unit: dispUnit } = toDisplayQty(ri.quantity, ing.unit);
                        const lineCost = ing.costPerUnit * ri.quantity;
                        return (
                          <div key={ri.ingredientId} className="flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0 bg-background">
                            <span className="flex-1 text-sm font-medium truncate">{ing.name}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <input
                                type="number" min="0.01" step="any" value={dispQty}
                                onChange={e => {
                                  const v = parseFloat(e.target.value) || 0.01;
                                  updateRecipeDisplayQty(ri.ingredientId, v, dispUnit, ing.unit);
                                }}
                                className="w-16 h-7 px-2 rounded-lg border border-input bg-background text-sm text-right font-semibold focus:outline-none focus:ring-1 focus:ring-ring/20"
                              />
                              <span className="text-xs font-medium text-muted-foreground w-6">{dispUnit}</span>
                            </div>
                            <span className="text-xs font-semibold text-success w-12 text-right shrink-0">{sym}{lineCost.toFixed(2)}</span>
                            <button type="button" onClick={() => removeRecipeItem(ri.ingredientId)} className="p-1 rounded hover:bg-destructive/10 transition-colors shrink-0">
                              <X className="w-3.5 h-3.5 text-destructive" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Cost summary */}
              {(form.recipe?.length ?? 0) > 0 && form.costPerServing != null ? (
                <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Auto cost per serving</span>
                    <span className="font-bold">{sym}{form.costPerServing.toFixed(2)}</span>
                  </div>
                  {form.price > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Gross margin</span>
                      <span className={`font-bold ${form.price - form.costPerServing >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {sym}{(form.price - form.costPerServing).toFixed(2)}
                        <span className="text-xs font-normal text-muted-foreground ml-1.5">
                          ({Math.round(((form.price - form.costPerServing) / form.price) * 100)}%)
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1.5">
                    Manual cost per serving ({sym}) <span className="opacity-60">— optional</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number" step="0.01" min="0" value={form.costPerServing ?? ''}
                      onChange={e => up('costPerServing', e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                      placeholder="e.g. 3.50"
                      className="w-32 h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                    {form.costPerServing != null && form.price > 0 && (
                      <span className={`text-sm font-semibold ${form.price - form.costPerServing >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {Math.round(((form.price - form.costPerServing) / form.price) * 100)}% margin
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </SectionToggle>

          {/* ── 7. Dietary & Allergens ── */}
          <SectionToggle
            title="Dietary & Allergens"
            badge={dietaryBadge}
            open={openSections.dietary}
            onToggle={() => toggleSection('dietary')}
          >
            <div className="space-y-4">
              {/* Allergens */}
              <div>
                <label className="text-xs font-semibold mb-2 block flex items-center gap-1.5">
                  <span className="text-sm">⚠️</span> Contains allergens
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {ALLERGEN_LIST.map(a => {
                    const active = (form.allergens ?? []).includes(a.id);
                    return (
                      <button
                        key={a.id} type="button"
                        onClick={() => toggleAllergen(a.id)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${active ? 'border-destructive/60 bg-destructive/10 text-destructive' : 'border-border bg-muted/30 text-muted-foreground hover:border-destructive/40'}`}
                      >
                        <span>{a.emoji}</span>
                        <span>{a.label}</span>
                        {active && <X className="w-3 h-3 ml-auto" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dietary tags */}
              <div>
                <label className="text-xs font-semibold mb-2 block flex items-center gap-1.5">
                  <Leaf className="w-3.5 h-3.5 text-green-600" /> Dietary labels
                </label>
                <div className="flex flex-wrap gap-2">
                  {DIETARY_LIST.map(d => {
                    const active = (form.dietaryTags ?? []).includes(d.id);
                    return (
                      <button
                        key={d.id} type="button"
                        onClick={() => toggleDietary(d.id)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${active ? d.color + ' border-current' : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'}`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Calories */}
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-xs font-semibold mb-1.5 block flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-orange-500" /> Calories (kcal)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" value={form.calories ?? ''}
                      onChange={e => up('calories', e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="e.g. 450"
                      className="w-28 h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                    />
                    <span className="text-xs text-muted-foreground">shown on customer menu</span>
                  </div>
                </div>
              </div>
            </div>
          </SectionToggle>

        </div>

        {/* ── Footer ── */}
        <div className="sticky bottom-0 bg-card/95 backdrop-blur-sm border-t border-border px-5 py-4">
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              {item ? 'Save Changes' : 'Add to Menu'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Modifier Group Editor ────────────────────────────────────────────────────

function ModifierGroupEditor({ mod, sym, onUpdate, onDelete, onAddOption, onRemoveOption, onUpdateOption }: {
  mod: Modifier;
  sym: string;
  onUpdate: (changes: Partial<Modifier>) => void;
  onDelete: () => void;
  onAddOption: () => void;
  onRemoveOption: (optId: string) => void;
  onUpdateOption: (optId: string, changes: Partial<ModifierOption>) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
        <button type="button" onClick={() => setExpanded(x => !x)} className="p-0.5 text-muted-foreground">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        <input
          value={mod.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium focus:outline-none focus:ring-0"
          placeholder="Group name (e.g. Size, Extras, Sauce)"
        />
        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox" checked={mod.required}
              onChange={e => onUpdate({ required: e.target.checked })}
              className="accent-primary"
            />
            Required
          </label>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Max:</span>
            <select
              value={mod.maxSelections}
              onChange={e => onUpdate({ maxSelections: parseInt(e.target.value) })}
              className="h-6 px-1 rounded border border-input bg-background text-xs focus:outline-none"
            >
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-3 space-y-2">
          {mod.options.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-1">No options yet — add one below.</p>
          )}
          {mod.options.map(opt => (
            <div key={opt.id} className="flex items-center gap-2">
              <input
                value={opt.name}
                onChange={e => onUpdateOption(opt.id, { name: e.target.value })}
                placeholder="Option name"
                className="flex-1 h-8 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring/20"
              />
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-muted-foreground">+{sym}</span>
                <input
                  type="number" step="0.10" min="0" value={opt.priceAdjustment}
                  onChange={e => onUpdateOption(opt.id, { priceAdjustment: parseFloat(e.target.value) || 0 })}
                  className="w-16 h-8 px-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring/20"
                />
              </div>
              <button type="button" onClick={() => onRemoveOption(opt.id)} className="p-1 rounded hover:bg-destructive/10 transition-colors shrink-0">
                <X className="w-3.5 h-3.5 text-destructive" />
              </button>
            </div>
          ))}
          <button
            type="button" onClick={onAddOption}
            className="flex items-center gap-1.5 text-xs text-primary font-medium hover:underline"
          >
            <Plus className="w-3 h-3" /> Add option
          </button>
        </div>
      )}
    </div>
  );
}
