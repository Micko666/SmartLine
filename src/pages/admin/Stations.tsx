import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, Plus, Pencil, Trash2, Copy, ExternalLink, ChefHat, Waves, UtensilsCrossed, Sliders, Eye, EyeOff, X } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buildStation, normalizeStation, ROLE_PRESETS, STATION_COLORS } from '@/domain/stations';
import type { Station, StationRole, OrderStatus } from '@/domain/types';

const ROLE_ICONS: Record<StationRole, React.ElementType> = {
  kitchen: ChefHat,
  service: UtensilsCrossed,
  bar: Waves,
  custom: Sliders,
};

const ROLE_DESCRIPTIONS: Record<StationRole, string> = {
  kitchen: 'Full cooking workflow — track orders, log events, adjust prep times',
  service: 'Floor staff — deliver orders, track tables, advance status',
  bar:     'Drinks only — filter to specific categories, track pour queue',
  custom:  'Custom permissions — configure exactly what this station can do',
};

const ALL_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready', 'completed', 'cancelled'];

// ─── Station Form ─────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  role: StationRole;
  pin: string;
  color: string;
  canAdvanceOrders: boolean;
  canCancelOrders: boolean;
  canLogKitchenEvents: boolean;
  canAdjustPrepTime: boolean;
  canReworkOrders: boolean;
  showProductionSummary: boolean;
  mapAccess: boolean;
  canUpdateTableStatus: boolean;
  canEditTableLayout: boolean;
  categoryMode: 'all' | 'focus' | 'exclusive';
  filterCategories: string[];
  visibleStatuses: OrderStatus[];
}

function defaultForm(role: StationRole = 'kitchen'): FormState {
  const preset = ROLE_PRESETS[role];
  return {
    name: '',
    role,
    pin: '',
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
    categoryMode: preset.permissions.categoryMode,
    filterCategories: [...preset.permissions.filterCategories],
    visibleStatuses: [...preset.permissions.visibleStatuses],
  };
}

function stationToForm(s: Station): FormState {
  const { permissions: p } = normalizeStation(s);
  return {
    name: s.name,
    role: s.role,
    pin: s.pin,
    color: s.color,
    canAdvanceOrders:      p.canAdvanceOrders,
    canCancelOrders:       p.canCancelOrders,
    canLogKitchenEvents:   p.canLogKitchenEvents,
    canAdjustPrepTime:     p.canAdjustPrepTime,
    canReworkOrders:       p.canReworkOrders,
    showProductionSummary: p.showProductionSummary,
    mapAccess:             p.mapAccess ?? false,
    canUpdateTableStatus:  p.canUpdateTableStatus ?? false,
    canEditTableLayout:    p.canEditTableLayout ?? false,
    categoryMode:          p.categoryMode ?? 'all',
    filterCategories:      [...p.filterCategories],
    visibleStatuses:       [...p.visibleStatuses],
  };
}

function StationForm({
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

  function removeCategory(cat: string) {
    onChange({ ...form, filterCategories: form.filterCategories.filter(c => c !== cat) });
  }

  // Determine which sections to show based on role
  const isKitchen = form.role === 'kitchen';
  const isBar     = form.role === 'bar';
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
        <Label>PIN (4–6 digits, leave blank for no lock)</Label>
        <div className="relative">
          <Input
            type={showPin ? 'text' : 'password'}
            placeholder="••••"
            inputMode="numeric"
            maxLength={6}
            value={form.pin}
            onChange={e => onChange({ ...form, pin: e.target.value.replace(/\D/g, '') })}
            className="pr-10"
          />
          <button
            type="button"
            onClick={onTogglePin}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          >
            {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
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

// ─── Station Card ─────────────────────────────────────────────────────────────

function StationCard({
  station,
  restaurantToken,
  onEdit,
  onDelete,
}: {
  station: Station;
  restaurantToken: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = ROLE_ICONS[station.role];
  const url = `${window.location.origin}/station/${restaurantToken}/${station.id}`;

  function copyUrl() {
    navigator.clipboard.writeText(url).then(() => toast.success('Station URL copied'));
  }

  const p = station.permissions;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: station.color + '22', color: station.color }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{station.name}</p>
          <p className="text-xs text-muted-foreground capitalize">{ROLE_PRESETS[station.role].label}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Permission chips */}
      <div className="flex flex-wrap gap-1.5">
        {p.canAdvanceOrders && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 font-medium">Advance orders</span>
        )}
        {p.canCancelOrders && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-400 font-medium">Cancel</span>
        )}
        {p.canLogKitchenEvents && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium">Kitchen events</span>
        )}
        {(p.canAdjustPrepTime ?? false) && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700 dark:text-orange-400 font-medium">Adjust timing</span>
        )}
        {(p.canReworkOrders ?? false) && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400 font-medium">Rework</span>
        )}
        {p.mapAccess && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium">Floor map</span>
        )}
        {p.canUpdateTableStatus && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-400 font-medium">Table control</span>
        )}
        {p.categoryMode !== 'all' && p.filterCategories && p.filterCategories.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">
            {p.categoryMode}: {p.filterCategories.join(', ')}
          </span>
        )}
        {station.pin ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">PIN locked</span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 font-medium">No PIN</span>
        )}
      </div>

      {/* URL row */}
      <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
        <span className="text-xs text-muted-foreground font-mono flex-1 truncate">/station/…/{station.id.slice(0, 8)}</span>
        <button onClick={copyUrl} className="text-muted-foreground hover:text-foreground transition-colors">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </motion.div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Stations() {
  const { settings, menuItems, addStation, updateStation, deleteStation } = useStore(useShallow(s => ({
    settings: s.settings,
    menuItems: s.menuItems,
    addStation: s.addStation,
    updateStation: s.updateStation,
    deleteStation: s.deleteStation,
  })));

  const stations = settings.stations ?? [];
  const restaurantToken = settings.restaurantToken;

  // Deduplicated category list from active menu items
  const availableCategories = Array.from(
    new Set(menuItems.filter(m => m.status === 'active').map(m => m.category))
  ).sort();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Station | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [showPin, setShowPin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);

  function openCreate() {
    setEditTarget(null);
    setForm(defaultForm());
    setShowPin(false);
    setDialogOpen(true);
  }

  function openEdit(station: Station) {
    setEditTarget(station);
    setForm(stationToForm(station));
    setShowPin(false);
    setDialogOpen(true);
  }

  function handleSave() {
    const name = form.name.trim();
    if (!name) { toast.error('Station name is required'); return; }
    if (form.pin && (form.pin.length < 4 || form.pin.length > 6)) {
      toast.error('PIN must be 4–6 digits'); return;
    }

    const permissions = {
      canAdvanceOrders: form.canAdvanceOrders,
      canCancelOrders: form.canCancelOrders,
      canLogKitchenEvents: form.canLogKitchenEvents,
      canAdjustPrepTime: form.canAdjustPrepTime,
      canReworkOrders: form.canReworkOrders,
      showProductionSummary: form.showProductionSummary,
      mapAccess: form.mapAccess,
      canUpdateTableStatus: form.canUpdateTableStatus,
      canEditTableLayout: form.canEditTableLayout,
      categoryMode: form.categoryMode,
      filterCategories: form.filterCategories,
      visibleStatuses: form.visibleStatuses,
    };

    if (editTarget) {
      updateStation(editTarget.id, { name, role: form.role, pin: form.pin, color: form.color, permissions });
      toast.success('Station updated');
    } else {
      const station = buildStation({ name, role: form.role, pin: form.pin, color: form.color, permissions });
      addStation(station);
      toast.success('Station created');
    }
    setDialogOpen(false);
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Station Profiles</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create PIN-protected screens for kitchen, service, and bar workstations
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            Add Station
          </Button>
        </div>

        {/* Empty state */}
        {stations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Monitor className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No stations yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a kitchen, bar, or service station to give staff a focused view
              </p>
            </div>
            <Button variant="outline" onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> Add your first station
            </Button>
          </div>
        )}

        {/* Station grid */}
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {stations.map(station => (
              <StationCard
                key={station.id}
                station={station}
                restaurantToken={restaurantToken}
                onEdit={() => openEdit(station)}
                onDelete={() => setDeleteTarget(station)}
              />
            ))}
          </div>
        </AnimatePresence>

        {/* How-to note */}
        {stations.length > 0 && (
          <div className="bg-muted/50 rounded-2xl p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">How station screens work:</strong> Each station has a unique URL — open it on any tablet or monitor. Staff enter the PIN once and stay unlocked for 12 hours. No user accounts needed.
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Station' : 'New Station'}</DialogTitle>
          </DialogHeader>
          <StationForm
            form={form}
            onChange={setForm}
            showPin={showPin}
            onTogglePin={() => setShowPin(p => !p)}
            availableCategories={availableCategories}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editTarget ? 'Save changes' : 'Create station'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete station?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be removed. Any devices using this station URL will lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteStation(deleteTarget.id);
                  toast.success('Station deleted');
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
