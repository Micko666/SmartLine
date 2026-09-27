import { useState } from 'react';
import { Plus, X, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { Modifier, ModifierOption } from '@/domain/types';

// ─── Modifier Group Editor ────────────────────────────────────────────────────

export default function ModifierGroupEditor({ mod, sym, onUpdate, onDelete, onAddOption, onRemoveOption, onUpdateOption }: {
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
