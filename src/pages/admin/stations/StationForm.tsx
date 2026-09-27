import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ROLE_PRESETS, STATION_COLORS } from '@/domain/stations';
import type { StationRole, OrderStatus } from '@/domain/types';
import { ROLE_ICONS, ROLE_DESCRIPTIONS, ALL_STATUSES, FormState } from './shared';

export default function StationForm({
  form,
  onChange,
  showPin,
  onTogglePin,
  availableCategories,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  showPin: boolean;
  onTogglePin: () => void;
  availableCategories: string[];
}) {
  const [catInput, setCatInput] = useState('');

  function setRole(role: StationRole) {
    const preset = ROLE_PRESETS[role];
    onChange({
      ...form,
      role,
      color: preset.color,
      canAdvanceOrders: preset.permissions.canAdvanceOrders,
      canCancelOrders: preset.permissions.canCancelOrders,
      canLogKitchenEvents: preset.permissions.canLogKitchenEvents,
      canAdjustPrepTime: preset.permissions.canAdjustPrepTime,
      canReworkOrders: preset.permissions.canReworkOrders,
      showProductionSummary: preset.permissions.showProductionSummary,
      mapAccess: preset.permissions.mapAccess,
      canUpdateTableStatus: preset.permissions.canUpdateTableStatus,
      canEditTableLayout: preset.permissions.canEditTableLayout,
      categoryMode: preset.permissions.categoryMode as 'all' | 'focus' | 'exclusive',
      filterCategories: [...preset.permissions.filterCategories],
      visibleStatuses: [...preset.permissions.visibleStatuses],
    });
  }

  function toggleStatus(s: OrderStatus) {
    const next = form.visibleStatuses.includes(s)
      ? form.visibleStatuses.filter(x => x !== s)
      : [...form.visibleStatuses, s];
    onChange({ ...form, visibleStatuses: next });
  }

  function addCategory(cat: string) {
    const trimmed = cat.trim();
    if (!trimmed || form.filterCategories.includes(trimmed)) return;
    onChange({ ...form, filterCategories: [...form.filterCategories, trimmed] });
    setCatInput('');
  }

  // Determine which sections to show based on role
  const isKitchen = form.role === 'kitchen';
  const isCustom  = form.role === 'custom';
  // service + custom: show all capabilities
  const showAllCaps = form.role === 'service' || isCustom;

  return (
    <div className="space-y-5">
      {/* Name */}
      <div className="space-y-1.5">
        <Label>Station name</Label>
        <Input
          placeholder="e.g. Kitchen A, Bar Counter"
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
        />
      </div>

      {/* Role pills */}
      <div className="space-y-1.5">
        <Label>Station type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(ROLE_PRESETS) as StationRole[]).map(role => {
            const Icon = ROLE_ICONS[role];
            const active = form.role === role;
            return (
              <button
                key={role}
                type="button"
                onClick={() => setRole(role)}
                className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-all ${
                  active
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-semibold">{ROLE_PRESETS[role].label}</span>
                </div>
                <span className="text-[10px] leading-tight opacity-70">{ROLE_DESCRIPTIONS[role]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Color */}
      <div className="space-y-1.5">
        <Label>Color</Label>
        <div className="flex gap-2 flex-wrap">
          {STATION_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ ...form, color: c })}
              className={`w-7 h-7 rounded-full transition-transform ${form.color === c ? 'ring-2 ring-offset-2 ring-foreground scale-110' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      {/* PIN */}
      <div className="space-y-1.5">
        <Label>{form.hasPin ? 'New PIN (4–6 digits, leave blank to keep the current PIN)' : 'PIN (4–6 digits, leave blank for no lock)'}</Label>
        <div className="relative">
          <Input
            type={showPin ? 'text' : 'password'}
            placeholder="••••"
            inputMode="numeric"
            maxLength={6}
            value={form.pin}
            onChange={e => onChange({ ...form, pin: e.target.value.replace(/\D/g, ''), removePin: false })}
            className="pr-10"
            disabled={form.removePin}
          />
          <button
            type="button"
            onClick={onTogglePin}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {form.hasPin && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={form.removePin}
              onChange={e => onChange({ ...form, removePin: e.target.checked, pin: '' })}
            />
            Remove PIN (anyone with the station link can open it)
          </label>
        )}
      </div>

      {/* ── Kitchen-specific capabilities ── */}
      {(isKitchen || isCustom) && (
        <div className="space-y-3">
          <Label>Kitchen capabilities</Label>
          {[
            { key: 'canLogKitchenEvents' as const,    label: 'Log kitchen events (waste, remakes, notes)' },
            { key: 'canAdjustPrepTime' as const,      label: 'Adjust prep time estimates on orders' },
            { key: 'canReworkOrders' as const,        label: 'Send orders back for rework' },
            { key: 'showProductionSummary' as const,  label: 'Show production summary (aggregated item counts)' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Switch
                checked={form[key]}
                onCheckedChange={v => onChange({ ...form, [key]: v })}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Shared order capabilities ── */}
      <div className="space-y-3">
        <Label>{isCustom ? 'Order permissions' : 'Permissions'}</Label>
        {[
          { key: 'canAdvanceOrders' as const, label: 'Advance order status (paid → preparing → ready…)' },
          { key: 'canCancelOrders' as const,  label: 'Cancel orders' },
          ...(showAllCaps && !isKitchen ? [
            { key: 'canLogKitchenEvents' as const, label: 'Log kitchen events (waste, remakes, notes)' },
          ] : []),
        ].map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{label}</span>
            <Switch
              checked={form[key]}
              onCheckedChange={v => onChange({ ...form, [key]: v })}
            />
          </div>
        ))}
      </div>

      {/* ── Map & table access ── */}
      {(form.role === 'service' || form.role === 'custom') && (
        <div className="space-y-3">
          <Label>Floor map & tables</Label>
          {[
            { key: 'mapAccess' as const, label: 'Floor map access', desc: 'Show the restaurant floor map on this station' },
            { key: 'canUpdateTableStatus' as const, label: 'Update table status', desc: 'Staff can mark tables as available or occupied' },
            { key: 'canEditTableLayout' as const, label: 'Edit table layout', desc: 'Reposition, add, or delete tables on the floor map (manager-level)' },
          ].map(({ key, label, desc }) => (
            <div key={key} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <Switch
                checked={form[key] as boolean}
                onCheckedChange={v => onChange({ ...form, [key]: v })}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Category behaviour ── */}
      {(form.role === 'bar' || form.role === 'service' || form.role === 'custom') && (
        <div className="space-y-3">
          <Label>Item visibility</Label>
          <div className="grid grid-cols-3 gap-2">
            {([
              { value: 'all',       label: 'All items',  desc: 'Show everything' },
              { value: 'focus',     label: 'Focus',      desc: 'Highlight my categories, dim others' },
              { value: 'exclusive', label: 'Exclusive',  desc: 'Only show my categories' },
            ] as const).map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ ...form, categoryMode: opt.value })}
                className={`flex flex-col gap-1 p-2.5 rounded-xl border text-left transition-all ${
                  form.categoryMode === opt.value
                    ? 'border-primary bg-primary/8 text-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                <span className="text-xs font-semibold">{opt.label}</span>
                <span className="text-[10px] leading-tight opacity-70">{opt.desc}</span>
              </button>
            ))}
          </div>

          {/* Category filter — shown when not 'all' mode */}
          {form.categoryMode !== 'all' && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-muted-foreground">
                {form.categoryMode === 'focus'
                  ? 'These categories will be highlighted. Other items appear dimmed.'
                  : 'Only orders containing these categories will appear.'}
              </p>
              {form.filterCategories.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {form.filterCategories.map(cat => {
                    const missing = !availableCategories.includes(cat);
                    return (
                      <span key={cat}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${
                          missing
                            ? 'bg-warning/10 text-warning border-warning/30'
                            : 'bg-primary/10 text-primary border-primary/20'
                        }`}
                        title={missing ? `"${cat}" not found in active menu categories` : undefined}
                      >
                        {missing && <span>⚠</span>}
                        {cat}
                        <button type="button" onClick={() => onChange({ ...form, filterCategories: form.filterCategories.filter(c => c !== cat) })}
                          className="hover:text-destructive transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
              {availableCategories.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {availableCategories
                    .filter(c => !form.filterCategories.includes(c))
                    .map(cat => (
                      <button key={cat} type="button"
                        onClick={() => { if (!form.filterCategories.includes(cat)) onChange({ ...form, filterCategories: [...form.filterCategories, cat] }); }}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >+ {cat}</button>
                    ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  placeholder="Type a category name…"
                  value={catInput}
                  onChange={e => setCatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory(catInput); } }}
                  className="flex-1 h-9 px-3 text-sm rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => addCategory(catInput)}>Add</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Visible order statuses */}
      <div className="space-y-2">
        <Label>Visible order statuses</Label>
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map(s => {
            const active = form.visibleStatuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-muted-foreground'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
