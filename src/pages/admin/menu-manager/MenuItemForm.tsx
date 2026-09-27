import { useState, useRef } from 'react';
import { Plus, X, Flame, Leaf, ImagePlus } from 'lucide-react';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import type { MenuItem, Modifier, ModifierOption, Ingredient, RecipeIngredient } from '@/domain/types';
import { toast } from 'sonner';
import { uploadMenuImage } from '@/lib/supabase/storage';
import { isSupabaseEnabled } from '@/store/flags';
import { ALLERGEN_LIST, DIETARY_LIST, kitchenUnitsFor, defaultKitchenEntry, toDisplayQty, FormData } from './shared';
import SectionToggle from './SectionToggle';
import ModifierGroupEditor from './ModifierGroupEditor';

export default function MenuItemForm({ item, categories, ingredients, sym, onSave, onClose, onAddCategory }: {
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
  // Stable id for Storage paths — reuse the real item id when editing, mint a new one for new items
  const uploadIdRef = useRef<string>(item?.id ?? (globalThis.crypto?.randomUUID?.() ?? `tmp-${Date.now()}`));
  const [uploadingImage, setUploadingImage] = useState(false);

  const up = <K extends keyof FormData>(key: K, val: FormData[K]) => {
    setForm(f => ({ ...f, [key]: val }));
    if (errors[key as string]) setErrors(e => ({ ...e, [key as string]: '' }));
  };

  const handleImageFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Image too large — max 8 MB');
      return;
    }
    const userId = useStore.getState().user?.id;
    // Fallback to base64 only when Supabase isn't available (offline/local mode)
    if (!isSupabaseEnabled() || !userId) {
      const reader = new FileReader();
      reader.onload = e => {
        const url = e.target?.result as string ?? '';
        setForm(f => ({ ...f, imageUrl: url, thumbnailUrl: url }));
      };
      reader.readAsDataURL(file);
      return;
    }
    setUploadingImage(true);
    try {
      const { imageUrl, thumbnailUrl } = await uploadMenuImage(file, userId, uploadIdRef.current);
      if (imageUrl && thumbnailUrl) {
        setForm(f => ({ ...f, imageUrl, thumbnailUrl }));
      } else {
        toast.error('Image upload failed — please try again');
      }
    } finally {
      setUploadingImage(false);
    }
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
                {uploadingImage && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <span className="text-[10px] text-white font-medium">Uploading…</span>
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
