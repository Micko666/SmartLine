import type { TableShape } from '@/domain/types';

// ─── TableShapeSvg ────────────────────────────────────────────────────────────

export default function TableShapeSvg({ shape, w, h, fill, stroke, strokeWidth = 2 }: {
  shape: TableShape; w: number; h: number; fill: string; stroke: string; strokeWidth?: number;
}) {
  if (shape === 'round') {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 3;
    return (
      <svg width={w} height={h} className="absolute inset-0 pointer-events-none">
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </svg>
    );
  }
  if (shape === 'l-shape') {
    // Use equal arm thickness based on the shorter side so both arms look the same
    const arm = Math.round(Math.min(w, h) * 0.45);
    const pts = `${2},${2} ${arm},${2} ${arm},${h-arm} ${w-2},${h-arm} ${w-2},${h-2} ${2},${h-2}`;
    return (
      <svg width={w} height={h} className="absolute inset-0 pointer-events-none">
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={w} height={h} className="absolute inset-0 pointer-events-none">
      <rect x={2} y={2} width={w - 4} height={h - 4} rx={shape === 'bar' ? 10 : 14}
        fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
}
