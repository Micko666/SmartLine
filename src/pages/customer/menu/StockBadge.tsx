

// ─── Stock badge ──────────────────────────────────────────────────────────────
export default function StockBadge({ stock, threshold }: { stock: number | null; threshold: number }) {
  if (stock === null) return null;
  if (stock === 0) return <span className="text-[10px] font-semibold text-destructive px-1.5 py-0.5 rounded-full bg-destructive/10">Unavailable</span>;
  if (stock === 1) return <span className="text-[10px] font-semibold text-destructive px-1.5 py-0.5 rounded-full bg-destructive/10 animate-pulse">Last one!</span>;
  if (stock <= threshold) return <span className="text-[10px] font-semibold text-warning px-1.5 py-0.5 rounded-full bg-warning/10">Only {stock} left</span>;
  return null;
}
