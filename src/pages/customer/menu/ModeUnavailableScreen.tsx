import { ChefHat } from 'lucide-react';
import { OrderMode, MODE_META } from './shared';

// ─── Mode Unavailable ─────────────────────────────────────────────────────────
export default function ModeUnavailableScreen({ mode, businessName, logoUrl }: { mode: OrderMode; businessName: string; logoUrl: string }) {
  const meta = MODE_META[mode];
  const Icon = meta.icon;
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center gap-6">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center">
        {logoUrl ? (
          <img src={logoUrl} alt="logo" className="w-full h-full rounded-2xl object-cover" />
        ) : (
          <ChefHat className="w-8 h-8 text-primary-foreground" />
        )}
      </div>
      <div>
        <h1 className="font-display text-xl font-bold">{businessName}</h1>
        <div className="mt-4 flex items-center justify-center gap-2 text-muted-foreground">
          <Icon className="w-5 h-5" />
          <span className="font-medium">{meta.label}</span>
        </div>
        <p className="text-muted-foreground text-sm mt-2">
          {meta.label} orders are not available right now.
        </p>
        <p className="text-xs text-muted-foreground mt-1">Please contact the restaurant or visit in person.</p>
      </div>
    </div>
  );
}
