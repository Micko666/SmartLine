import type { Order } from '@/domain/types';

// ─── ProductionSummary ────────────────────────────────────────────────────────

export default function ProductionSummary({ orders }: { orders: Order[] }) {
  const incoming = orders.filter(o => o.status === 'paid' || o.status === 'preparing');
  if (incoming.length === 0) return null;

  const totals = new Map<string, number>();
  for (const order of incoming) {
    for (const item of order.items) {
      totals.set(item.menuItemName, (totals.get(item.menuItemName) ?? 0) + item.quantity);
    }
  }
  if (totals.size === 0) return null;

  return (
    <div className="border-b border-yellow-500/20 bg-yellow-500/5 px-4 py-2.5 flex items-start gap-3 shrink-0">
      <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse" />
        <span className="text-[11px] font-bold text-yellow-700 dark:text-yellow-400 uppercase tracking-wide whitespace-nowrap">
          {incoming.length} active
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 min-w-0">
        {Array.from(totals.entries()).map(([name, qty]) => (
          <span key={name} className="text-xs text-foreground/75 whitespace-nowrap">
            <span className="font-bold text-foreground">{qty}×</span> {name}
          </span>
        ))}
      </div>
    </div>
  );
}
