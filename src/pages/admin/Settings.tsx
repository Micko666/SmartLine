import { useState } from 'react';
import { Save, ChefHat, Globe, Clock, CreditCard, Package, ImagePlus, Wifi, WifiOff } from 'lucide-react';
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
  const { settings, updateSettings } = useStore(useShallow(s => ({ settings: s.settings, updateSettings: s.updateSettings })));
  const [form, setForm] = useState({ ...settings });
  const [dirty, setDirty] = useState(false);

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
