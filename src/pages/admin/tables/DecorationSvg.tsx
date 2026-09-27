import type { DecorationType } from '@/domain/types';

// ─── DecorationSvg ────────────────────────────────────────────────────────────

export default function DecorationSvg({ type, w, h, selected }: {
  type: DecorationType; w: number; h: number; selected: boolean;
}) {
  const accent = selected ? '#0d9488' : undefined;

  if (type === 'door') {
    // Floor-plan door: wall segment + swing arc
    const thick = Math.max(8, h * 0.18);
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <rect x={0} y={h - thick} width={thick} height={thick} fill={accent ?? '#94a3b8'} rx={2} />
        <path
          d={`M ${thick / 2} ${h - thick} A ${h - thick} ${h - thick} 0 0 1 ${h - thick / 2} ${h}`}
          fill="rgba(148,163,184,0.12)" stroke={accent ?? '#94a3b8'} strokeWidth={1.5} strokeDasharray="4 3"
        />
        <line x1={thick / 2} y1={h - thick} x2={h - thick / 2} y2={h} stroke={accent ?? '#94a3b8'} strokeWidth={1.5} />
      </svg>
    );
  }

  if (type === 'plant') {
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.28;
    return (
      <svg width={w} height={h} className="pointer-events-none">
        {/* Pot */}
        <rect x={cx - r * 0.7} y={cy + r * 0.5} width={r * 1.4} height={r * 0.9} fill={accent ?? '#78716c'} rx={3} />
        {/* Main foliage */}
        <circle cx={cx} cy={cy - r * 0.15} r={r} fill={accent ?? '#16a34a'} />
        <circle cx={cx - r * 0.6} cy={cy + r * 0.1} r={r * 0.7} fill={accent ?? '#15803d'} />
        <circle cx={cx + r * 0.6} cy={cy + r * 0.1} r={r * 0.7} fill={accent ?? '#15803d'} />
        <circle cx={cx} cy={cy - r * 0.9} r={r * 0.55} fill={accent ?? '#22c55e'} />
      </svg>
    );
  }

  if (type === 'pillar') {
    const r = Math.min(w, h) / 2 - 3;
    const cx = w / 2, cy = h / 2;
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <circle cx={cx} cy={cy} r={r} fill={accent ?? '#cbd5e1'} stroke={accent ?? '#94a3b8'} strokeWidth={2} />
        <circle cx={cx} cy={cy} r={r * 0.45} fill={accent ?? '#94a3b8'} />
      </svg>
    );
  }

  if (type === 'window') {
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <rect x={1} y={1} width={w - 2} height={h - 2} fill="rgba(147,197,253,0.25)" stroke={accent ?? '#60a5fa'} strokeWidth={2} rx={2} />
        <line x1={w / 2} y1={1} x2={w / 2} y2={h - 1} stroke={accent ?? '#60a5fa'} strokeWidth={1.5} />
        <line x1={1} y1={h / 2} x2={w - 1} y2={h / 2} stroke={accent ?? '#60a5fa'} strokeWidth={1.5} />
      </svg>
    );
  }

  if (type === 'stairs') {
    const steps = 4;
    const sw = (w - 4) / steps;
    const sh = (h - 4) / steps;
    return (
      <svg width={w} height={h} className="pointer-events-none">
        {Array.from({ length: steps }).map((_, i) => (
          <rect key={i}
            x={2 + sw * i} y={2 + sh * i}
            width={sw * (steps - i)} height={sh}
            fill={accent ? `${accent}22` : 'rgba(148,163,184,0.18)'}
            stroke={accent ?? '#94a3b8'} strokeWidth={1}
          />
        ))}
      </svg>
    );
  }

  // wall
  return (
    <svg width={w} height={h} className="pointer-events-none">
      <rect x={0} y={0} width={w} height={h} fill={accent ?? '#94a3b8'} rx={4} />
      <rect x={2} y={2} width={w - 4} height={h - 4} fill={accent ? `${accent}33` : 'rgba(203,213,225,0.6)'} rx={2} />
    </svg>
  );
}
