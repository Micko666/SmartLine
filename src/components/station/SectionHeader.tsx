/** Reusable section header for station order lists. */

interface SectionHeaderProps {
  label: string;
  count: number;
  color: string;
  /** Omits the trailing separator line — use in dense/scrolling lists. */
  compact?: boolean;
}

export default function SectionHeader({ label, count, color, compact }: SectionHeaderProps) {
  return (
    <div className={`flex items-center gap-2 ${compact ? 'mb-2' : 'mb-3'}`}>
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
      {count > 0 && (
        <span
          className="text-xs font-bold px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: color + '18', color }}
        >
          {count}
        </span>
      )}
      {!compact && <div className="flex-1 h-px bg-border/60" />}
    </div>
  );
}
