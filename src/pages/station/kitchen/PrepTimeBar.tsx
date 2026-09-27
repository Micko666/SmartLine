import { minutesSince } from '@/lib/time';
import type { Order } from '@/domain/types';

// ─── PrepTimeBar ─────────────────────────────────────────────────────────────

export default function PrepTimeBar({ order }: { order: Order }) {
  const elapsed = minutesSince(order.createdAt);
  const total = Math.max(1, order.estimatedPrepTime + order.prepTimeAdjustment);
  const pct = Math.min(100, (elapsed / total) * 100);
  const barColor = pct >= 90 ? '#ef4444' : pct >= 65 ? '#f97316' : '#22c55e';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{elapsed}m elapsed</span>
        <span>{total}m target</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
    </div>
  );
}
