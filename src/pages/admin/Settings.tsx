import { useState } from 'react';
import { Save, ChefHat, Globe, CreditCard, Package, ImagePlus, Wifi, WifiOff, Link2, UtensilsCrossed, CalendarDays, Users, ShoppingBag, PauseCircle, CloudUpload, RefreshCw, Image as ImageIcon } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { isSupabaseEnabled } from '@/store/flags';

const BUSINESS_TYPES = ['Restaurant', 'Café', 'Bakery', 'Pastry Shop', 'Fast Food', 'Bar & Lounge', 'Food Truck'];
const CURRENCIES = [{ code: 'EUR', symbol: '€', label: 'EUR (€)' }, { code: 'USD', symbol: '$', label: 'USD ($)' }, { code: 'GBP', symbol: '£', label: 'GBP (£)' }, { code: 'CHF', symbol: 'CHF', label: 'CHF' }];
const SERVICE_MODES = ['dine-in', 'takeaway', 'pickup', 'quick-service', 'bakery-workflow'];
const LANGUAGES = ['English', 'French', 'German', 'Spanish', 'Italian', 'Arabic'];

export default function Settings() {
  const { settings, updateSettings, menuItems } = useStore(useShallow(s => ({ settings: s.settings, updateSettings: s.updateSettings, menuItems: s.menuItems })));
  const base64ImageCount = menuItems.filter(
    m => m.imageUrl?.startsWith('data:') || m.thumbnailUrl?.startsWith('data:'),
  ).length;
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<{ processed: number; total: number; name?: string } | null>(null);

  async function handleMigrateImages() {
    const state = useStore.getState();
    const userId = state.user?.id;
    if (!userId) return;

    const base64Count = state.menuItems.filter(
      m => m.imageUrl?.startsWith('data:') || m.thumbnailUrl?.startsWith('data:'),
    ).length;
    if (base64Count === 0) {
      toast.success('No images need migration — you\'re already on cloud storage.');
      return;
    }

    setMigrating(true);
    setMigrateProgress({ processed: 0, total: base64Count });
    try {
      const { migrateBase64ToStorage } = await import('@/lib/supabase/storage');
      const result = await migrateBase64ToStorage(
        state.menuItems,
        userId,
        async (itemId, imageUrl, thumbnailUrl) => {
          useStore.getState().updateMenuItem(itemId, { imageUrl, thumbnailUrl });
        },
        p => setMigrateProgress({ processed: p.processed, total: p.total, name: p.currentName }),
      );
      if (result.failed > 0) {
        toast.warning(`Migrated ${result.succeeded} of ${result.total} images — ${result.failed} failed.`);
      } else {
        toast.success(`All ${result.succeeded} images moved to cloud storage.`);
      }
    } catch {
      toast.error('Migration failed — check your connection and try again.');
    } finally {
      setMigrating(false);
      setMigrateProgress(null);
    }
  }

  async function handleSyncToCloud() {
    setSyncing(true);
    try {
      const state = useStore.getState();
      const { pushLocalToSupabase } = await import('@/store/hydration');
      await pushLocalToSupabase({
        menuItems:        state.menuItems,
        tables:           state.tables,
        employees:        state.employees,
        shifts:           state.shifts,
        settings:         state.settings,
        calendarSettings: state.calendarSettings,
        nextOrderNumber:  state.nextOrderNumber,
      }, state.user!.id);
      toast.success('All data synced to cloud successfully');
    } catch {
      toast.error('Sync failed — check your connection and try again');
    } finally {
      setSyncing(false);
    }
  }

  const up = <K extends keyof typeof form>(key: K, val: typeof form[K]) => {
    setForm(f => ({ ...f, [key]: val }));
    setDirty(true);
  };

  const handleSave = () => {
    // Validate
    if (!form.businessName.trim()) { toast.error('Business name is required.'); return; }
    if (form.taxRate < 0 || form.taxRate > 100) { toast.error('Tax rate must be between 0 and 100.'); return; }
    if (form.lowStockThreshold < 0) { toast.error('Low stock threshold must be 0 or more.'); return; }

    // Sync currency symbol
    const cur = CURRENCIES.find(c => c.code === form.currency);
    if (cur) form.currencySymbol = cur.symbol;

    updateSettings(form);
    setDirty(false);
    toast.success('Settings saved');
  };

  const input = 'w-full h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors';
  const select = input;

  return (
    <DashboardLayout>
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Changes are persisted across sessions</p>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${isSupabaseEnabled() ? 'bg-green-500/10 text-green-600' : 'bg-yellow-500/10 text-yellow-600'}`}>
            {isSupabaseEnabled() ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isSupabaseEnabled() ? 'Cloud sync active' : 'Local mode (no cloud)'}
          </div>
          {dirty && (
            <button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Save className="w-4 h-4" /> Save Changes
            </button>
          )}
        </div>

        {/* Cloud Sync — only shown when Supabase is enabled */}
        {isSupabaseEnabled() && (
          <section className="glass-card p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <CloudUpload className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Sync local data to cloud</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pushes all menu items, tables, employees, shifts, and settings from this device to Supabase.
                Run this once if your public links show empty data or after restoring from backup.
              </p>
            </div>
            <button
              onClick={handleSyncToCloud}
              disabled={syncing}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </section>
        )}

        {/* Migrate Images to Cloud Storage */}
        {isSupabaseEnabled() && (base64ImageCount > 0 || migrating) && (
          <section className="glass-card p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <ImageIcon className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Move menu photos to cloud storage</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {migrating && migrateProgress
                  ? `Migrating ${migrateProgress.processed} / ${migrateProgress.total}${migrateProgress.name ? ` — ${migrateProgress.name}` : ''}…`
                  : `${base64ImageCount} ${base64ImageCount === 1 ? 'photo is' : 'photos are'} stored inline in the database. Migrate to Supabase Storage to restore them on the public menu and make loads faster.`}
              </p>
            </div>
            <button
              onClick={handleMigrateImages}
              disabled={migrating}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${migrating ? 'animate-spin' : ''}`} />
              {migrating ? 'Migrating…' : 'Migrate now'}
            </button>
          </section>
        )}

        {/* Business Profile */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <ChefHat className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Business Profile</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block">Restaurant Name *</label>
              <input value={form.businessName} onChange={e => up('businessName', e.target.value)} className={input} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Business Type</label>
              <select value={form.businessType} onChange={e => up('businessType', e.target.value)} className={select}>
                {BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Opening Hours</label>
              <input value={form.openingHours} onChange={e => up('openingHours', e.target.value)} placeholder="e.g. 08:00 – 23:00" className={input} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Service Mode</label>
              <select value={form.serviceMode} onChange={e => up('serviceMode', e.target.value)} className={select}>
                {SERVICE_MODES.map(m => <option key={m} value={m}>{m.replace('-', ' ')}</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Localisation */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Localisation</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block">Currency</label>
              <select value={form.currency} onChange={e => up('currency', e.target.value)} className={select}>
                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Language</label>
              <select value={form.language} onChange={e => up('language', e.target.value)} className={select}>
                {LANGUAGES.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Timezone</label>
              <input value={form.timezone} onChange={e => up('timezone', e.target.value)} className={input} />
            </div>
          </div>
        </section>

        {/* Tax */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Taxes & Pricing</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block">Tax Rate (%)</label>
              <input type="number" min="0" max="100" step="0.1" value={form.taxRate} onChange={e => up('taxRate', parseFloat(e.target.value) || 0)} className={input} />
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">Tax Display</label>
              <select value={form.taxDisplay} onChange={e => up('taxDisplay', e.target.value as typeof form['taxDisplay'])} className={select}>
                <option value="inclusive">Prices include tax</option>
                <option value="exclusive">Add tax at checkout</option>
                <option value="hidden">Don't show tax</option>
              </select>
            </div>
          </div>
        </section>

        {/* Inventory */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Inventory & Stock</h2>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium mb-1.5 block">Low Stock Threshold</label>
              <input type="number" min="0" value={form.lowStockThreshold} onChange={e => up('lowStockThreshold', parseInt(e.target.value) || 0)} className={input} />
              <p className="text-xs text-muted-foreground mt-1">Items at or below this count show a warning badge</p>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block">When Stock Reaches 0</label>
              <select value={form.zeroStockBehavior} onChange={e => up('zeroStockBehavior', e.target.value as typeof form['zeroStockBehavior'])} className={select}>
                <option value="disable">Grey out & show "Unavailable"</option>
                <option value="hide">Hide item from customer menu</option>
              </select>
            </div>
          </div>
        </section>

        {/* Online Ordering */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingBag className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Online Ordering</h2>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-xl border border-border bg-muted/20">
            <div className="flex-1">
              <p className="text-sm font-semibold">Pause all online ordering</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Closes dine-in table selection, takeaway, and delivery on the public portal. Useful for private events, fully-booked days, or off days.
              </p>
            </div>
            <button
              type="button"
              onClick={() => up('orderingPaused', !form.orderingPaused)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none ${form.orderingPaused ? 'bg-destructive' : 'bg-muted-foreground/30'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${form.orderingPaused ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {form.orderingPaused && (
            <div>
              <label className="text-xs font-medium mb-1.5 block flex items-center gap-1">
                <PauseCircle className="w-3 h-3 text-destructive" />
                Message shown to customers when ordering is paused
              </label>
              <textarea
                value={form.orderingPausedMessage}
                onChange={e => up('orderingPausedMessage', e.target.value)}
                rows={3}
                className={`${input} h-auto py-2 resize-none`}
                placeholder="e.g. We're closed for a private event today. See you tomorrow from 12:00!"
              />
              <p className="text-xs text-muted-foreground mt-1">Leave blank to show a default "We're not accepting orders right now" message.</p>
            </div>
          )}
        </section>

        {/* QR / App URL */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <ImagePlus className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Deployment URL</h2>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block">App URL (used in QR codes)</label>
            <input value={form.appUrl} onChange={e => up('appUrl', e.target.value)} placeholder="https://yourapp.com" className={input} />
            <p className="text-xs text-muted-foreground mt-1">QR codes for tables will link to <span className="font-mono text-primary">{form.appUrl}/menu?t=&#123;tableId&#125;</span></p>
          </div>
        </section>

        {/* Public Links */}
        <section className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Public Links</h2>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">Share these with customers and staff. Links are tied to your restaurant token and work without a login.</p>

          {[
            {
              icon: UtensilsCrossed,
              label: 'Food Order Portal',
              description: 'Dine-in guide, takeaway & delivery orders',
              href: `${window.location.origin}/order/${settings.restaurantToken}`,
            },
            {
              icon: CalendarDays,
              label: 'Event Booking',
              description: 'Private events, group reservations, packages',
              href: `${window.location.origin}/book/${settings.restaurantToken}`,
            },
            {
              icon: Users,
              label: 'Staff Roster',
              description: 'Read-only weekly schedule for your team',
              href: `${window.location.origin}/roster/${settings.restaurantToken}`,
            },
          ].map(({ icon: Icon, label, description, href }) => (
            <div key={label} className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-tight">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
                <code className="text-[11px] text-muted-foreground font-mono truncate block mt-0.5">{href}</code>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => { navigator.clipboard.writeText(href); toast.success(`${label} link copied`); }}
                  className="text-xs font-medium text-primary hover:underline px-2 py-1 rounded-lg hover:bg-primary/5 transition-colors">
                  Copy
                </button>
                <a href={href} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-muted transition-colors">
                  Open
                </a>
              </div>
            </div>
          ))}
        </section>

        <button
          onClick={handleSave}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Save className="w-4 h-4" /> Save All Changes
        </button>
      </div>
    </DashboardLayout>
  );
}
