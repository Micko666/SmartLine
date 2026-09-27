import { useState } from 'react';
import { Plus, X, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import type { CartItemModifier, MenuItem } from '@/domain/types';
import { DIETARY_EMOJI, DIETARY_STYLE, ALLERGEN_EMOJI } from './shared';

// ─── Item Detail Sheet ────────────────────────────────────────────────────────
export default function ItemSheet({ item, sym, onAdd, onClose }: {
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
