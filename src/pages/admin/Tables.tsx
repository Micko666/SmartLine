import { useEffect, useRef, useState } from 'react';
import {
  Plus, Trash2, QrCode, Download, ExternalLink, X, Copy,
  Pencil, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight,
  Users, Layers, RotateCw, Flower2, DoorOpen, Columns3, AppWindow, Footprints, Minus, ChevronDown,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import QRCode from 'react-qr-code';
import DashboardLayout from '@/components/layout/DashboardLayout';
import FloorMapCanvas from '@/components/floor/FloorMapCanvas';
import TablePanel from '@/components/station/TablePanel';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { Table, TableShape, TableStatus, MapDecoration, DecorationType, Order, MenuItem, CategoryMode } from '@/domain/types';
import { getTableSize, ZONE_PALETTE, TABLE_STATUS_COLOR, TABLE_STATUS_LABEL, TABLE_STATUS_CYCLE } from '@/domain/tables';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 1600;
const CANVAS_H = 960;
const GRID = 20;

const STATUS_COLOR = TABLE_STATUS_COLOR;
const STATUS_LABEL = TABLE_STATUS_LABEL;
const STATUS_CYCLE = TABLE_STATUS_CYCLE;

const SHAPE_OPTIONS: { value: TableShape; label: string }[] = [
  { value: 'square',  label: 'Rectangle' },
  { value: 'round',   label: 'Round'     },
  { value: 'l-shape', label: 'L-Shape'   },
  { value: 'bar',     label: 'Bar'       },
];

const CAPACITY_PRESETS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

// ─── Decoration config ────────────────────────────────────────────────────────

const DECORATION_DEFAULTS: Record<DecorationType, { w: number; h: number; label: string }> = {
  door:    { w: 60, h: 60,  label: 'Door'    },
  plant:   { w: 48, h: 48,  label: 'Plant'   },
  pillar:  { w: 40, h: 40,  label: 'Pillar'  },
  window:  { w: 80, h: 24,  label: 'Window'  },
  stairs:  { w: 80, h: 80,  label: 'Stairs'  },
  wall:    { w: 120, h: 20, label: 'Wall'    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function snapGrid(v: number) { return Math.round(v / GRID) * GRID; }
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Returns the absolute CSS positioning for the resize grip so it always sits
 * at the VISUAL bottom-right (SE) corner regardless of the element's CSS
 * rotation.  Rotation is in degrees; only multiples of 90° are expected.
 *
 *   0°  → DOM bottom-right  → { bottom: -8, right: -8 }
 *  90°  → DOM top-right     → { top:    -8, right: -8 }
 * 180°  → DOM top-left      → { top:    -8, left:  -8 }
 * 270°  → DOM bottom-left   → { bottom: -8, left:  -8 }
 */
function resizeGripPos(rotation: number): React.CSSProperties {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 90)  return { position: 'absolute', top:    -8, right:  -8 };
  if (r === 180) return { position: 'absolute', top:    -8, left:   -8 };
  if (r === 270) return { position: 'absolute', bottom: -8, left:   -8 };
  return               { position: 'absolute', bottom: -8, right:  -8 };
}

function cycleStatus(current: TableStatus, dir: 1 | -1): TableStatus {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[((i + dir) + STATUS_CYCLE.length) % STATUS_CYCLE.length];
}

function zoneBounds(tables: Table[], zone: string, padding = 32) {
  const zts = tables.filter(t => t.zone === zone && t.x != null && t.y != null);
  if (zts.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of zts) {
    const { w, h } = getTableSize(t.shape ?? 'square', t.capacity, t.sizeScale ?? 1);
    minX = Math.min(minX, t.x!); minY = Math.min(minY, t.y!);
    maxX = Math.max(maxX, t.x! + w); maxY = Math.max(maxY, t.y! + h);
  }
  return { left: minX - padding, top: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

function computeAutoPositions(tables: Table[]): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = {};
  const unpos = tables.filter(t => t.x == null || t.y == null);
  if (unpos.length === 0) return result;
  const COLS = 5, CELL = 176, ZONE_GAP = 80, START_X = 60;
  let curY = 60;
  const byZone: Record<string, Table[]> = {};
  const noZone: Table[] = [];
  for (const t of unpos) {
    if (t.zone) (byZone[t.zone] = byZone[t.zone] ?? []).push(t);
    else noZone.push(t);
  }
  function layoutGroup(group: Table[]) {
    const nonBars = group.filter(t => (t.shape ?? 'square') !== 'bar');
    const bars    = group.filter(t => (t.shape ?? 'square') === 'bar');
    nonBars.forEach((t, i) => {
      result[t.id] = { x: START_X + (i % COLS) * CELL, y: curY + Math.floor(i / COLS) * CELL };
    });
    if (nonBars.length) curY += Math.ceil(nonBars.length / COLS) * CELL + 20;
    bars.forEach((t, i) => {
      const { w } = getTableSize('bar', t.capacity, t.sizeScale ?? 1);
      result[t.id] = { x: START_X + (i % 3) * (w + 24), y: curY + Math.floor(i / 3) * 100 };
    });
    if (bars.length) curY += Math.ceil(bars.length / 3) * 100 + 20;
    curY += ZONE_GAP;
  }
  Object.values(byZone).forEach(layoutGroup);
  if (noZone.length) layoutGroup(noZone);
  return result;
}

function makeQrDownloader(qrRef: React.RefObject<HTMLDivElement>, fileName: string) {
  return function download(format: 'svg' | 'png') {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    if (format === 'svg') {
      const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${fileName}.svg`; a.click();
      URL.revokeObjectURL(a.href); toast.success('SVG downloaded');
    } else {
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      clone.setAttribute('width', String(size)); clone.setAttribute('height', String(size));
      const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml' });
      const imgUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, size, size);
        URL.revokeObjectURL(imgUrl);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${fileName}.png`; a.click();
        toast.success('PNG downloaded');
      };
      img.src = imgUrl;
    }
  };
}

// ─── TableShapeSvg ────────────────────────────────────────────────────────────

function TableShapeSvg({ shape, w, h, fill, stroke, strokeWidth = 2 }: {
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

// ─── DecorationSvg ────────────────────────────────────────────────────────────

function DecorationSvg({ type, w, h, selected }: {
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

// ─── TableTile ────────────────────────────────────────────────────────────────

function TableTile({
  table, x, y, selected, dragging, resizeSizeScale, activeOrders,
  onPointerDown, onPointerMove, onPointerUp,
  onResizeStart, onResizeMove, onResizeEnd,
}: {
  table: Table; x: number; y: number; selected: boolean; dragging: boolean;
  resizeSizeScale: number | null; activeOrders: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp:   (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeMove:  (e: React.PointerEvent) => void;
  onResizeEnd:   (e: React.PointerEvent) => void;
}) {
  const shape = table.shape ?? 'square';
  const effectiveScale = resizeSizeScale ?? (table.sizeScale ?? 1);
  const { w, h } = getTableSize(shape, table.capacity, effectiveScale);
  const color = STATUS_COLOR[table.status];
  const isBar = shape === 'bar';
  const rotation = (shape === 'l-shape') ? (table.rotation ?? 0) : 0;

  // Adaptive text size based on tile pixel width
  const numSize = w < 84 ? 'text-lg' : w < 108 ? 'text-xl' : 'text-2xl';

  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h,
        cursor: dragging ? 'grabbing' : 'pointer',
        userSelect: 'none', touchAction: 'none',
        zIndex: dragging ? 200 : selected ? 100 : 10,
        transition: dragging ? 'none' : 'filter 0.12s',
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
        filter: selected
          ? `drop-shadow(0 0 0 2.5px #0d9488) drop-shadow(0 2px 8px rgba(13,148,136,0.18))`
          : dragging ? 'drop-shadow(0 6px 20px rgba(0,0,0,0.18))' : 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <TableShapeSvg
        shape={shape} w={w} h={h}
        fill={selected ? `${color}22` : `${color}14`}
        stroke={selected ? '#0d9488' : `${color}50`}
        strokeWidth={selected ? 2.5 : 1.5}
      />

      {activeOrders > 0 && (
        <div className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-[9px] font-bold text-white flex items-center justify-center shadow z-20">
          {activeOrders}
        </div>
      )}

      <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full z-10 ring-2 ring-background" style={{ backgroundColor: color }} />

      {isBar ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pl-3 pr-6 pointer-events-none select-none z-10">
          <span className="font-display font-black text-foreground text-sm leading-none">{table.number}</span>
          <span className="text-muted-foreground font-medium text-[10px] leading-tight truncate w-full text-center">{table.name}</span>
        </div>
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-2 pointer-events-none select-none z-10"
          style={rotation ? { transform: `rotate(${-rotation}deg)` } : undefined}
        >
          <span className={`font-display font-black text-foreground ${numSize} leading-none`}>{table.number}</span>
          <span className="text-muted-foreground font-medium text-[10px] leading-tight text-center max-w-full truncate">{table.name}</span>
          {w >= 90 && (
            <span className="text-[9px] text-muted-foreground/50 flex items-center gap-0.5"><Users className="w-2.5 h-2.5" />{table.capacity}</span>
          )}
        </div>
      )}

      {/* Resize grip — always at the visual SE corner regardless of rotation */}
      {selected && (
        <div
          style={{ ...resizeGripPos(rotation), width: 20, height: 20, zIndex: 30 }}
          className="rounded-full bg-primary border-2 border-background shadow-md cursor-se-resize flex items-center justify-center"
          title="Drag to resize"
          onPointerDown={e => { e.stopPropagation(); onResizeStart(e); }}
          onPointerMove={e => { e.stopPropagation(); onResizeMove(e); }}
          onPointerUp={e => { e.stopPropagation(); onResizeEnd(e); }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="opacity-60">
            <path d="M1 7L7 1M4 7L7 4M7 7V7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── DecorationTile ───────────────────────────────────────────────────────────

function DecorationTile({
  decoration, x, y, selected, dragging,
  onPointerDown, onPointerMove, onPointerUp,
  onResizeStart, onResizeMove, onResizeEnd,
}: {
  decoration: MapDecoration; x: number; y: number; selected: boolean; dragging: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp:   (e: React.PointerEvent) => void;
  onResizeStart: (e: React.PointerEvent) => void;
  onResizeMove:  (e: React.PointerEvent) => void;
  onResizeEnd:   (e: React.PointerEvent) => void;
}) {
  const { w, h } = decoration;
  return (
    <div
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h,
        cursor: dragging ? 'grabbing' : 'pointer',
        userSelect: 'none', touchAction: 'none',
        zIndex: dragging ? 190 : selected ? 90 : 5,
        transform: decoration.rotation ? `rotate(${decoration.rotation}deg)` : undefined,
        transformOrigin: 'center center',
        outline: selected ? '2px dashed #0d9488' : undefined,
        outlineOffset: selected ? '2px' : undefined,
        opacity: selected ? 1 : 0.82,
        transition: dragging ? 'none' : 'opacity 0.12s',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <DecorationSvg type={decoration.type} w={w} h={h} selected={selected} />

      {selected && (
        <div
          style={{ ...resizeGripPos(decoration.rotation ?? 0), width: 20, height: 20, zIndex: 30 }}
          className="rounded-full bg-primary border-2 border-background shadow-md cursor-se-resize flex items-center justify-center"
          title="Drag to resize"
          onPointerDown={e => { e.stopPropagation(); onResizeStart(e); }}
          onPointerMove={e => { e.stopPropagation(); onResizeMove(e); }}
          onPointerUp={e => { e.stopPropagation(); onResizeEnd(e); }}
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="pointer-events-none opacity-60">
            <path d="M1 7L7 1M4 7L7 4M7 7V7" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}

// ─── Inspector ────────────────────────────────────────────────────────────────

function Inspector({
  table, appUrl, restaurantToken, activeOrders,
  onEdit, onDelete, onStatusCycle, onDeselect, onOpenQr, onRotate,
}: {
  table: Table; appUrl: string; restaurantToken: string; activeOrders: number;
  onEdit: () => void; onDelete: () => void;
  onStatusCycle: (dir: 1 | -1) => void;
  onDeselect: () => void; onOpenQr: () => void; onRotate: () => void;
}) {
  const color = STATUS_COLOR[table.status];
  const url = `${appUrl}/menu?t=${table.id}&r=${restaurantToken}`;
  const qrRef = useRef<HTMLDivElement>(null);
  const fileName = `qr-${table.name.replace(/\s+/g, '-').toLowerCase()}`;
  const downloadQr = makeQrDownloader(qrRef, fileName);

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
      className="w-72 shrink-0 bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm"
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pt-4 pb-3 border-b border-border">
        <div className="flex-1 min-w-0 pr-2">
          <div className="flex items-baseline gap-2">
            <span className="font-display font-black text-3xl text-foreground leading-none">{table.number}</span>
            <span className="font-semibold text-sm text-foreground truncate leading-snug">{table.name}</span>
          </div>
          {(table.zone || table.floor) && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {table.zone  && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">{table.zone}</span>}
              {table.floor && <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5"><Layers className="w-2.5 h-2.5" />{table.floor}</span>}
            </div>
          )}
        </div>
        <button onClick={onDeselect} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Status + stats */}
        <div className="px-4 py-3 space-y-2.5 border-b border-border">
          <div className="flex items-center gap-1.5">
            <button onClick={() => onStatusCycle(-1)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors shrink-0">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 flex items-center justify-center gap-2 py-1.5 rounded-xl transition-colors" style={{ backgroundColor: `${color}12`, border: `1px solid ${color}28` }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span className="text-sm font-semibold" style={{ color }}>{STATUS_LABEL[table.status]}</span>
            </div>
            <button onClick={() => onStatusCycle(1)} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground transition-colors shrink-0">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted rounded-xl py-2 text-center">
              <p className="text-[10px] text-muted-foreground">Seats</p>
              <p className="font-bold text-sm text-foreground">{table.capacity}</p>
            </div>
            <div className="bg-muted rounded-xl py-2 text-center">
              <p className="text-[10px] text-muted-foreground">Orders</p>
              <p className="font-bold text-sm" style={{ color: activeOrders > 0 ? '#f97316' : undefined }}>{activeOrders}</p>
            </div>
          </div>
        </div>

        {/* QR section */}
        <div className="px-4 py-4 space-y-2.5 border-b border-border">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Customer QR</p>
          <div
            ref={qrRef}
            onClick={onOpenQr}
            className="bg-white rounded-2xl p-4 flex items-center justify-center cursor-zoom-in hover:ring-2 hover:ring-primary/25 transition-all"
            title="Click to enlarge"
          >
            <QRCode value={url} size={148} />
          </div>
          <button
            onClick={() => { navigator.clipboard.writeText(url); toast.success('Link copied'); }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-muted hover:bg-muted/60 transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Copy customer link</span>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => downloadQr('svg')} className="flex items-center justify-center gap-1.5 h-8 rounded-xl border border-border text-xs font-medium hover:bg-muted transition-colors text-muted-foreground">
              <Download className="w-3 h-3" /> SVG
            </button>
            <button onClick={() => downloadQr('png')} className="flex items-center justify-center gap-1.5 h-8 rounded-xl border border-border text-xs font-medium hover:bg-muted transition-colors text-muted-foreground">
              <Download className="w-3 h-3" /> PNG
            </button>
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 h-8 rounded-xl border border-border text-xs font-medium hover:bg-muted transition-colors text-muted-foreground w-full"
          >
            <ExternalLink className="w-3 h-3" /> Open customer menu
          </a>
        </div>

        {/* Rotate (l-shape only) */}
        {table.shape === 'l-shape' && (
          <div className="px-4 pt-3 border-b border-border pb-3">
            <button onClick={onRotate}
              className="w-full flex items-center justify-center gap-2 h-8 rounded-xl border border-border text-xs font-medium hover:bg-muted transition-colors text-muted-foreground">
              <RotateCw className="w-3.5 h-3.5" /> Rotate 90°
            </button>
          </div>
        )}

        {/* Edit / Delete */}
        <div className="px-4 py-3 grid grid-cols-2 gap-2">
          <button onClick={onEdit} className="flex items-center justify-center gap-1.5 h-9 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors text-foreground">
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
          <button onClick={onDelete} className="flex items-center justify-center gap-1.5 h-9 rounded-xl border border-destructive/20 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Decoration Inspector ─────────────────────────────────────────────────────

const DEC_ICONS: Record<DecorationType, React.ElementType> = {
  door:   DoorOpen,
  plant:  Flower2,
  pillar: Columns3,
  window: AppWindow,
  stairs: Footprints,
  wall:   Minus,
};

function DecorationInspector({
  decoration, onDelete, onRotate, onDeselect,
}: {
  decoration: MapDecoration;
  onDelete: () => void; onRotate: () => void; onDeselect: () => void;
}) {
  const Icon = DEC_ICONS[decoration.type];
  const label = DECORATION_DEFAULTS[decoration.type].label;

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }}
      className="w-72 shrink-0 bg-card border border-border rounded-2xl flex flex-col overflow-hidden shadow-sm"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground leading-none">{label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Map decoration</p>
          </div>
        </div>
        <button onClick={onDeselect} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-4 py-4 space-y-2">
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="bg-muted rounded-xl py-2 text-center">
            <p className="text-[10px]">Width</p>
            <p className="font-bold text-sm text-foreground">{Math.round(decoration.w)}px</p>
          </div>
          <div className="bg-muted rounded-xl py-2 text-center">
            <p className="text-[10px]">Height</p>
            <p className="font-bold text-sm text-foreground">{Math.round(decoration.h)}px</p>
          </div>
        </div>

        <button onClick={onRotate}
          className="w-full flex items-center justify-center gap-2 h-8 rounded-xl border border-border text-xs font-medium hover:bg-muted transition-colors text-muted-foreground">
          <RotateCw className="w-3.5 h-3.5" /> Rotate 90°
        </button>

        <p className="text-[10px] text-muted-foreground/60 text-center pt-1">Drag the grip corner to resize</p>

        <button onClick={onDelete}
          className="w-full flex items-center justify-center gap-1.5 h-9 rounded-xl border border-destructive/20 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors">
          <Trash2 className="w-3.5 h-3.5" /> Remove
        </button>
      </div>
    </motion.div>
  );
}

// ─── QrSheet (full-screen modal) ──────────────────────────────────────────────

function QrSheet({ table, url, restaurantName, onClose }: {
  table: Table; url: string; restaurantName: string; onClose: () => void;
}) {
  const qrRef = useRef<HTMLDivElement>(null);
  const fileName = `qr-${table.name.replace(/\s+/g, '-').toLowerCase()}`;
  const downloadQr = makeQrDownloader(qrRef, fileName);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border border-border rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{restaurantName}</p>
            <h2 className="font-display font-bold text-xl mt-0.5">{table.name}</h2>
            {table.zone && <p className="text-xs text-muted-foreground">{table.zone}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted text-muted-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div ref={qrRef} className="mx-5 bg-white rounded-2xl p-6 flex justify-center">
          <QRCode value={url} size={228} />
        </div>
        <button
          onClick={() => { navigator.clipboard.writeText(url); toast.success('URL copied'); }}
          className="mx-5 mt-3 flex items-center gap-2 w-[calc(100%-40px)] bg-muted rounded-xl px-3 py-2 hover:bg-muted/70 transition-colors"
        >
          <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] text-muted-foreground font-mono truncate">{url}</span>
        </button>
        <div className="p-5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => downloadQr('svg')} className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Download className="w-4 h-4" /> SVG
            </button>
            <button onClick={() => downloadQr('png')} className="flex items-center justify-center gap-1.5 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
              <Download className="w-4 h-4" /> PNG
            </button>
          </div>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Open customer menu
          </a>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── TableFormDialog ──────────────────────────────────────────────────────────

interface TableFormData { name: string; capacity: number; shape: TableShape; zone: string; floor: string; }

function TableFormDialog({ open, onOpenChange, table, existingZones, existingFloors, defaultFloor, defaultName, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  table: Table | null; existingZones: string[]; existingFloors: string[]; defaultFloor?: string; defaultName?: string;
  onSave: (data: TableFormData) => void;
}) {
  const [form, setForm] = useState<TableFormData>({ name: '', capacity: 4, shape: 'square', zone: '', floor: '' });
  const [newZone, setNewZone] = useState(''); const [creatingZone, setCreatingZone] = useState(false);
  const [newFloor, setNewFloor] = useState(''); const [creatingFloor, setCreatingFloor] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: table?.name ?? defaultName ?? '', capacity: table?.capacity ?? 4, shape: table?.shape ?? 'square', zone: table?.zone ?? '', floor: table?.floor ?? defaultFloor ?? '' });
      setNewZone(''); setCreatingZone(false); setNewFloor(''); setCreatingFloor(false);
    }
  }, [open, table, defaultFloor, defaultName]);

  function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    onSave({
      ...form,
      name:  form.name.trim(),
      zone:  creatingZone  ? newZone.trim()  : form.zone,
      floor: creatingFloor ? newFloor.trim() : form.floor,
    });
  }

  const allZones  = [...new Set([...existingZones,  ...(table?.zone  ? [table.zone]  : [])])];
  const allFloors = [...new Set([...existingFloors, ...(table?.floor ? [table.floor] : [])])];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{table ? 'Edit table' : 'Add table'}</DialogTitle></DialogHeader>
        <div className="space-y-5 py-1">

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="e.g. Table 5, Window Seat, Bar Counter" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          </div>

          {/* Shape — fixed-height preview containers so labels align */}
          <div className="space-y-1.5">
            <Label>Shape</Label>
            <div className="grid grid-cols-4 gap-2">
              {SHAPE_OPTIONS.map(opt => {
                const isActive = form.shape === opt.value;
                // Each preview reflects the actual shape proportions
                const [pw, ph] = opt.value === 'bar'     ? [44, 14]
                               : opt.value === 'square'  ? [40, 26]  // landscape rectangle
                               : opt.value === 'l-shape' ? [30, 30]
                               :                           [26, 26];  // round → circle
                return (
                  <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, shape: opt.value }))}
                    className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl border text-[11px] font-medium transition-all ${
                      isActive ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground'
                    }`}
                  >
                    {/* Fixed-height container so all labels land at same vertical position */}
                    <div className="flex items-center justify-center" style={{ width: 44, height: 34 }}>
                      <div className="relative" style={{ width: pw, height: ph }}>
                        <TableShapeSvg shape={opt.value} w={pw} h={ph}
                          fill={isActive ? 'rgba(13,148,136,0.12)' : 'rgba(100,116,139,0.08)'}
                          stroke={isActive ? '#0d9488' : '#94a3b8'}
                        />
                      </div>
                    </div>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Seats */}
          <div className="space-y-1.5">
            <Label>Seats</Label>
            <div className="flex flex-wrap gap-2">
              {CAPACITY_PRESETS.map(n => (
                <button key={n} type="button" onClick={() => setForm(f => ({ ...f, capacity: n }))}
                  className={`w-10 h-10 rounded-xl text-sm font-semibold border transition-all ${
                    form.capacity === n ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >{n}</button>
              ))}
            </div>
          </div>

          {/* Floor */}
          <div className="space-y-1.5">
            <Label>Floor <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            {!creatingFloor ? (
              <div className="flex gap-2">
                <select value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                  className="flex-1 h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">No floor</option>
                  {allFloors.map(fl => <option key={fl} value={fl}>{fl}</option>)}
                </select>
                <button type="button" onClick={() => setCreatingFloor(true)}
                  className="px-3 h-10 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors whitespace-nowrap"
                >+ New</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="Floor name (e.g. Terrace)" value={newFloor} onChange={e => setNewFloor(e.target.value)} autoFocus />
                <button type="button" onClick={() => setCreatingFloor(false)}
                  className="px-3 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted"
                >Back</button>
              </div>
            )}
          </div>

          {/* Zone */}
          <div className="space-y-1.5">
            <Label>Zone <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            {!creatingZone ? (
              <div className="flex gap-2">
                <select value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  className="flex-1 h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">No zone</option>
                  {allZones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                <button type="button" onClick={() => setCreatingZone(true)}
                  className="px-3 h-10 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors whitespace-nowrap"
                >+ New</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="Zone name (e.g. Terrace)" value={newZone} onChange={e => setNewZone(e.target.value)} autoFocus />
                <button type="button" onClick={() => setCreatingZone(false)}
                  className="px-3 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted"
                >Back</button>
              </div>
            )}
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>{table ? 'Save changes' : 'Add table'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ZonesDialog ──────────────────────────────────────────────────────────────

function ZonesDialog({ open, onOpenChange, zones, zoneColors, tableCounts, onRename, onDelete }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  zones: string[]; zoneColors: Record<string, typeof ZONE_PALETTE[0]>;
  tableCounts: Record<string, number>;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState<{ orig: string; val: string } | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Manage Zones</DialogTitle></DialogHeader>
        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No zones yet. Add a zone when creating or editing a table.</p>
        ) : (
          <div className="space-y-2 py-1">
            {zones.map(zone => {
              const zc = zoneColors[zone];
              const count = tableCounts[zone] ?? 0;
              const isEditing = editing?.orig === zone;
              return (
                <div key={zone} className="flex items-center gap-3 p-2 rounded-xl border border-border bg-background">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zc.text }} />
                  {isEditing ? (
                    <input
                      autoFocus value={editing!.val}
                      onChange={e => setEditing(ed => ed ? { ...ed, val: e.target.value } : null)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && editing!.val.trim()) { onRename(zone, editing!.val.trim()); setEditing(null); }
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="flex-1 h-7 px-2 rounded-lg border border-primary bg-background text-sm focus:outline-none"
                    />
                  ) : (
                    <span className="flex-1 text-sm font-medium text-foreground">{zone}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">{count} table{count !== 1 ? 's' : ''}</span>
                  {isEditing ? (
                    <button onClick={() => { if (editing!.val.trim()) { onRename(zone, editing!.val.trim()); setEditing(null); } }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-primary">
                      <span className="text-xs font-bold">✓</span>
                    </button>
                  ) : (
                    <button onClick={() => setEditing({ orig: zone, val: zone })}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={() => onDelete(zone)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-destructive/70 hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── FloorSelector ────────────────────────────────────────────────────────────

function FloorSelector({ floors, active, tableCounts, onSelect, onRename, onDelete }: {
  floors: string[];
  active: string | null;
  tableCounts: Record<string, number>;
  onSelect: (floor: string | null) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [renameVal, setRenameVal] = useState('');

  if (floors.length === 0) return null;

  function openEdit() {
    if (!active) return;
    setRenameVal(active);
    setEditOpen(true);
  }

  function commitRename() {
    const name = renameVal.trim();
    if (name && name !== active) onRename(active!, name);
    setEditOpen(false);
  }

  function commitDelete() {
    onDelete(active!);
    setEditOpen(false);
  }

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="relative">
          <select
            value={active ?? ''}
            onChange={e => onSelect(e.target.value || null)}
            className="h-8 pl-3 pr-8 rounded-xl border border-input bg-background text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring/20 text-foreground"
          >
            {floors.length > 1 && <option value="">All floors</option>}
            {floors.map(f => (
              <option key={f} value={f}>
                {f} ({tableCounts[f] ?? 0})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {active && (
          <button
            onClick={openEdit}
            className="w-8 h-8 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
            title="Edit floor"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Edit floor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Floor name</Label>
              <Input
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); }}
                autoFocus
              />
            </div>
            <Button onClick={commitRename} className="w-full">Save name</Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={commitDelete}
            >
              Delete this floor
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Props Palette ────────────────────────────────────────────────────────────

const PROP_PALETTE: { type: DecorationType; label: string; Icon: React.ElementType }[] = [
  { type: 'door',   label: 'Door',   Icon: DoorOpen   },
  { type: 'plant',  label: 'Plant',  Icon: Flower2    },
  { type: 'pillar', label: 'Pillar', Icon: Columns3   },
  { type: 'window', label: 'Window', Icon: AppWindow  },
  { type: 'stairs', label: 'Stairs', Icon: Footprints },
  { type: 'wall',   label: 'Wall',   Icon: Minus      },
];

function PropsPalette({ onAdd, onClose }: { onAdd: (type: DecorationType) => void; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.97 }}
      className="absolute right-0 top-12 z-50 bg-card border border-border rounded-2xl shadow-xl p-3 w-64"
    >
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Decor</p>
        <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {PROP_PALETTE.map(({ type, label, Icon }) => (
          <button
            key={type}
            onClick={() => { onAdd(type); onClose(); }}
            className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border border-border hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary transition-all"
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground/60 mt-2.5 text-center">Click to place · Drag to move · Resize grip to scale</p>
    </motion.div>
  );
}

// ─── Tables page ──────────────────────────────────────────────────────────────

export default function Tables() {
  const {
    tables, addTable, updateTable, deleteTable, setTableStatus, settings, orders, menuItems,
    decorations, addDecoration, updateDecoration, deleteDecoration, advanceOrderStatus,
  } = useStore(useShallow(s => ({
    tables: s.tables, addTable: s.addTable, updateTable: s.updateTable,
    deleteTable: s.deleteTable, setTableStatus: s.setTableStatus,
    settings: s.settings, orders: s.orders, menuItems: s.menuItems,
    decorations: s.decorations, addDecoration: s.addDecoration,
    updateDecoration: s.updateDecoration, deleteDecoration: s.deleteDecoration,
    advanceOrderStatus: s.advanceOrderStatus,
  })));

  const appUrl = typeof window !== 'undefined' ? window.location.origin : settings.appUrl;
  const getTableUrl = (id: string) => `${appUrl}/menu?t=${id}&r=${settings.restaurantToken}`;
  const activeOrdersFor = (id: string) =>
    orders.filter(o => o.tableId === id && ['paid', 'preparing', 'ready'].includes(o.status)).length;

  // ── Floor state ──────────────────────────────────────────────────────────────
  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const [pendingFloors, setPendingFloors] = useState<string[]>([]);

  const derivedFloors = [...new Set(tables.map(t => t.floor).filter(Boolean) as string[])];
  const livePending = pendingFloors.filter(f => !derivedFloors.includes(f));
  const allFloors = [...new Set([...derivedFloors, ...livePending])];

  useEffect(() => {
    setPendingFloors(prev => prev.filter(f => !derivedFloors.includes(f)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables]);

  // When floors are first defined (and "All" tab is hidden), auto-select the first floor
  // so the canvas isn't showing mixed/overlapping tables from multiple floors.
  useEffect(() => {
    if (allFloors.length > 0 && activeFloor === null) {
      setActiveFloor(allFloors[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFloors.length > 0]);

  const visibleTables = activeFloor ? tables.filter(t => t.floor === activeFloor) : tables;
  const visibleDecorations = activeFloor ? decorations.filter(d => d.floor === activeFloor) : decorations;

  function handleFloorSelect(floor: string | null) {
    if (floor && !allFloors.includes(floor)) setPendingFloors(prev => [...prev, floor]);
    setActiveFloor(floor);
  }

  function handleFloorRename(oldName: string, newName: string) {
    if (!newName || newName === oldName) return;
    tables.filter(t => t.floor === oldName).forEach(t => updateTable(t.id, { floor: newName }));
    decorations.filter(d => d.floor === oldName).forEach(d => updateDecoration(d.id, { floor: newName }));
    setPendingFloors(prev => prev.map(f => f === oldName ? newName : f));
    if (activeFloor === oldName) setActiveFloor(newName);
    toast.success(`Renamed to "${newName}"`);
  }

  function handleFloorDelete(name: string) {
    tables.filter(t => t.floor === name).forEach(t => updateTable(t.id, { floor: undefined }));
    decorations.filter(d => d.floor === name).forEach(d => updateDecoration(d.id, { floor: undefined }));
    setPendingFloors(prev => prev.filter(f => f !== name));
    if (activeFloor === name) setActiveFloor(null);
    toast.success(`Floor "${name}" removed`);
  }

  // ── Zone data ────────────────────────────────────────────────────────────────
  const zones = [...new Set(tables.map(t => t.zone).filter(Boolean) as string[])];
  const visibleZones = [...new Set(visibleTables.map(t => t.zone).filter(Boolean) as string[])];
  const zoneColors: Record<string, typeof ZONE_PALETTE[0]> = {};
  zones.forEach((z, i) => { zoneColors[z] = ZONE_PALETTE[i % ZONE_PALETTE.length]; });
  const zoneTableCounts: Record<string, number> = {};
  zones.forEach(z => { zoneTableCounts[z] = tables.filter(t => t.zone === z).length; });
  const floorTableCounts: Record<string, number> = {};
  derivedFloors.forEach(f => { floorTableCounts[f] = tables.filter(t => t.floor === f).length; });

  function handleZoneRename(oldName: string, newName: string) {
    tables.filter(t => t.zone === oldName).forEach(t => updateTable(t.id, { zone: newName.trim() || undefined }));
    toast.success(newName.trim() ? `Renamed to "${newName.trim()}"` : `Zone "${oldName}" removed`);
  }
  function handleZoneDelete(name: string) {
    tables.filter(t => t.zone === name).forEach(t => updateTable(t.id, { zone: undefined }));
    toast.success(`Zone "${name}" removed`);
  }

  // ── Auto-layout ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const unpos = tables.filter(t => t.x == null || t.y == null);
    if (unpos.length === 0) return;
    const autoPos = computeAutoPositions(tables);
    unpos.forEach(t => { const p = autoPos[t.id]; if (p) updateTable(t.id, { x: p.x, y: p.y }); });
    if (unpos.length > 1) toast.info('Tables auto-arranged — drag to reposition');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Scale & canvas ───────────────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale(s => clamp(+(s - e.deltaY * 0.001).toFixed(2), 0.4, 2.0));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  function fitView() {
    const visible = visibleTables.filter(t => t.x != null && t.y != null);
    if (!containerRef.current || visible.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of visible) {
      const { w, h } = getTableSize(t.shape ?? 'square', t.capacity, t.sizeScale ?? 1);
      const x = t.x!, y = t.y!;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
    }
    const pad = 60;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const newScale = clamp(Math.min(cw / (maxX - minX + pad * 2), ch / (maxY - minY + pad * 2)), 0.4, 1.5);
    setScale(newScale);
    setTimeout(() => {
      containerRef.current?.scrollTo({ left: (minX - pad) * newScale, top: (minY - pad) * newScale, behavior: 'smooth' });
    }, 50);
  }

  // ── Table drag ───────────────────────────────────────────────────────────────
  const dragRef = useRef<{ id: string; startCX: number; startCY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const [dragState, setDragState] = useState<{ id: string; x: number; y: number } | null>(null);

  function getPos(table: Table) {
    if (dragState?.id === table.id) return { x: dragState.x, y: dragState.y };
    return { x: table.x ?? 60, y: table.y ?? 60 };
  }

  function handlePointerDown(e: React.PointerEvent, table: Table) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getPos(table);
    dragRef.current = { id: table.id, startCX: e.clientX, startCY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
  }

  function handlePointerMove(e: React.PointerEvent, table: Table) {
    if (!dragRef.current || dragRef.current.id !== table.id) return;
    const dx = (e.clientX - dragRef.current.startCX) / scale;
    const dy = (e.clientY - dragRef.current.startCY) / scale;
    if (!dragRef.current.moved && Math.sqrt(dx * dx + dy * dy) > 4) dragRef.current.moved = true;
    if (!dragRef.current.moved) return;
    const { w, h } = getTableSize(table.shape ?? 'square', table.capacity, table.sizeScale ?? 1);
    const nx = clamp(snapGrid(dragRef.current.origX + dx), 0, CANVAS_W - w);
    const ny = clamp(snapGrid(dragRef.current.origY + dy), 0, CANVAS_H - h);
    setDragState({ id: table.id, x: nx, y: ny });
  }

  function handlePointerUp(e: React.PointerEvent, table: Table) {
    if (!dragRef.current || dragRef.current.id !== table.id) return;
    const wasDrag = dragRef.current.moved;
    if (wasDrag && dragState) {
      updateTable(table.id, { x: dragState.x, y: dragState.y });
    } else {
      setSelectedTable(prev => prev === table.id ? null : table.id);
      setSelectedDec(null);
    }
    dragRef.current = null;
    setDragState(null);
  }

  // ── Table resize ─────────────────────────────────────────────────────────────
  const resizeRef = useRef<{ id: string; startCX: number; startCY: number; baseW: number; origScale: number; shape: TableShape } | null>(null);
  const [resizeState, setResizeState] = useState<{ id: string; sizeScale: number } | null>(null);

  function handleResizeStart(e: React.PointerEvent, table: Table) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { w } = getTableSize(table.shape ?? 'square', table.capacity, 1);
    resizeRef.current = {
      id: table.id, startCX: e.clientX, startCY: e.clientY,
      baseW: w, origScale: table.sizeScale ?? 1, shape: table.shape ?? 'square',
    };
  }

  function handleResizeMove(e: React.PointerEvent, table: Table) {
    if (!resizeRef.current || resizeRef.current.id !== table.id) return;
    const dx = (e.clientX - resizeRef.current.startCX) / scale;
    const dy = (e.clientY - resizeRef.current.startCY) / scale;
    const diag = (dx + dy) / 2;
    const currentW = resizeRef.current.baseW * resizeRef.current.origScale;
    const newW = Math.max(48, currentW + diag);
    const newScale = clamp(newW / resizeRef.current.baseW, 0.4, 3.0);
    setResizeState({ id: table.id, sizeScale: newScale });
  }

  function handleResizeEnd(_e: React.PointerEvent, table: Table) {
    if (!resizeRef.current || resizeRef.current.id !== table.id) return;
    if (resizeState?.id === table.id) {
      updateTable(table.id, { sizeScale: Math.round(resizeState.sizeScale * 100) / 100 });
    }
    resizeRef.current = null;
    setResizeState(null);
  }

  // ── Decoration drag ──────────────────────────────────────────────────────────
  const dragDecRef = useRef<{ id: string; startCX: number; startCY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const [dragDecState, setDragDecState] = useState<{ id: string; x: number; y: number } | null>(null);

  function getDecPos(dec: MapDecoration) {
    if (dragDecState?.id === dec.id) return { x: dragDecState.x, y: dragDecState.y };
    return { x: dec.x, y: dec.y };
  }

  function handleDecPointerDown(e: React.PointerEvent, dec: MapDecoration) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getDecPos(dec);
    dragDecRef.current = { id: dec.id, startCX: e.clientX, startCY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
  }

  function handleDecPointerMove(e: React.PointerEvent, dec: MapDecoration) {
    if (!dragDecRef.current || dragDecRef.current.id !== dec.id) return;
    const dx = (e.clientX - dragDecRef.current.startCX) / scale;
    const dy = (e.clientY - dragDecRef.current.startCY) / scale;
    if (!dragDecRef.current.moved && Math.sqrt(dx * dx + dy * dy) > 4) dragDecRef.current.moved = true;
    if (!dragDecRef.current.moved) return;
    const nx = clamp(snapGrid(dragDecRef.current.origX + dx), 0, CANVAS_W - dec.w);
    const ny = clamp(snapGrid(dragDecRef.current.origY + dy), 0, CANVAS_H - dec.h);
    setDragDecState({ id: dec.id, x: nx, y: ny });
  }

  function handleDecPointerUp(e: React.PointerEvent, dec: MapDecoration) {
    if (!dragDecRef.current || dragDecRef.current.id !== dec.id) return;
    const wasDrag = dragDecRef.current.moved;
    if (wasDrag && dragDecState) {
      updateDecoration(dec.id, { x: dragDecState.x, y: dragDecState.y });
    } else {
      setSelectedDec(prev => prev === dec.id ? null : dec.id);
      setSelectedTable(null);
    }
    dragDecRef.current = null;
    setDragDecState(null);
  }

  // ── Decoration resize ────────────────────────────────────────────────────────
  const resizeDecRef = useRef<{ id: string; startCX: number; startCY: number; origW: number; origH: number; rotation: number } | null>(null);
  const [resizeDecState, setResizeDecState] = useState<{ id: string; w: number; h: number } | null>(null);

  function handleDecResizeStart(e: React.PointerEvent, dec: MapDecoration) {
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeDecRef.current = { id: dec.id, startCX: e.clientX, startCY: e.clientY, origW: dec.w, origH: dec.h, rotation: dec.rotation ?? 0 };
  }

  function handleDecResizeMove(e: React.PointerEvent, dec: MapDecoration) {
    if (!resizeDecRef.current || resizeDecRef.current.id !== dec.id) return;
    const dx = (e.clientX - resizeDecRef.current.startCX) / scale;
    const dy = (e.clientY - resizeDecRef.current.startCY) / scale;
    // At 90° or 270° the element's local width/height axes are swapped relative
    // to the screen — dragging down increases width and right increases height.
    const r = ((resizeDecRef.current.rotation % 360) + 360) % 360;
    const [localDx, localDy] = (r === 90 || r === 270) ? [dy, dx] : [dx, dy];
    const nw = clamp(Math.round(resizeDecRef.current.origW + localDx), 20, 400);
    const nh = clamp(Math.round(resizeDecRef.current.origH + localDy), 12, 400);
    setResizeDecState({ id: dec.id, w: nw, h: nh });
  }

  function handleDecResizeEnd(_e: React.PointerEvent, dec: MapDecoration) {
    if (!resizeDecRef.current || resizeDecRef.current.id !== dec.id) return;
    if (resizeDecState?.id === dec.id) {
      updateDecoration(dec.id, { w: resizeDecState.w, h: resizeDecState.h });
    }
    resizeDecRef.current = null;
    setResizeDecState(null);
  }

  // ── Canvas pan ───────────────────────────────────────────────────────────────
  const panRef = useRef<{ startX: number; startY: number; sl: number; st: number } | null>(null);

  function handleCanvasBgDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    setSelectedTable(null); setSelectedDec(null);
    panRef.current = { startX: e.clientX, startY: e.clientY, sl: containerRef.current?.scrollLeft ?? 0, st: containerRef.current?.scrollTop ?? 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleCanvasBgMove(e: React.PointerEvent) {
    if (!panRef.current) return;
    if (containerRef.current) {
      containerRef.current.scrollLeft = panRef.current.sl + (panRef.current.startX - e.clientX);
      containerRef.current.scrollTop  = panRef.current.st  + (panRef.current.startY - e.clientY);
    }
  }
  function handleCanvasBgUp() { panRef.current = null; }

  // ── UI state ─────────────────────────────────────────────────────────────────
  const [pageMode, setPageMode]           = useState<'edit' | 'operate'>('edit');
  const [operationalTable, setOperationalTable] = useState<Table | null>(null);

  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedDec, setSelectedDec]     = useState<string | null>(null);
  const [qrTable, setQrTable]             = useState<Table | null>(null);
  const [formOpen, setFormOpen]           = useState(false);
  const [editTarget, setEditTarget]       = useState<Table | null>(null);
  const [zonesOpen, setZonesOpen]         = useState(false);
  const [propsOpen, setPropsOpen]         = useState(false);
  const [addDefaultName, setAddDefaultName] = useState('');

  // ── Operate mode handlers ─────────────────────────────────────────────────
  const OP_STATUSES = ['paid', 'preparing', 'ready'];

  function handleAdminAdvance(order: Order) {
    advanceOrderStatus(order.id);
  }

  function handleAdminClearTable(table: Table) {
    setTableStatus(table.id, 'available');
    toast.success(`${table.name} is now available`);
    setOperationalTable(null);
  }

  function switchToOperate() {
    setPageMode('operate');
    setSelectedTable(null);
    setSelectedDec(null);
    setOperationalTable(null);
  }

  function switchToEdit() {
    setPageMode('edit');
    setOperationalTable(null);
  }

  const selectedTableObj = selectedTable ? tables.find(t => t.id === selectedTable) ?? null : null;
  const selectedDecObj   = selectedDec   ? decorations.find(d => d.id === selectedDec) ?? null : null;

  function openAdd() {
    setEditTarget(null);
    const nextNum = tables.length > 0 ? Math.max(...tables.map(t => t.number)) + 1 : 1;
    setAddDefaultName(`Table ${nextNum}`);
    setFormOpen(true);
  }
  function openEdit(t: Table) { setEditTarget(t); setFormOpen(true); }

  function handleDelete(table: Table) {
    if (activeOrdersFor(table.id) > 0) { toast.error(`${table.name} has active orders`); return; }
    deleteTable(table.id); if (selectedTable === table.id) setSelectedTable(null);
    toast.success(`${table.name} deleted`);
  }

  function handleSave(data: TableFormData) {
    const { w, h } = getTableSize(data.shape, data.capacity); void h;
    if (editTarget) {
      updateTable(editTarget.id, { name: data.name, capacity: data.capacity, shape: data.shape, zone: data.zone || undefined, floor: data.floor || undefined });
      toast.success('Table updated');
    } else {
      const nextNum = tables.length > 0 ? Math.max(...tables.map(t => t.number)) + 1 : 1;
      const x = snapGrid(clamp(CANVAS_W / 2 - w / 2 + (Math.random() - 0.5) * 120, 60, CANVAS_W - w - 60));
      const y = snapGrid(clamp(CANVAS_H / 2 - 48 + (Math.random() - 0.5) * 80, 60, CANVAS_H - 160));
      addTable({ number: nextNum, name: data.name, capacity: data.capacity, shape: data.shape, zone: data.zone || undefined, floor: data.floor || undefined, x, y });
      toast.success(`${data.name} added`);
    }
    setFormOpen(false); setEditTarget(null);
  }

  function handleAddProp(type: DecorationType) {
    const defs = DECORATION_DEFAULTS[type];
    const cx = containerRef.current ? containerRef.current.scrollLeft / scale + containerRef.current.clientWidth / scale / 2 : CANVAS_W / 2;
    const cy = containerRef.current ? containerRef.current.scrollTop  / scale + containerRef.current.clientHeight / scale / 2 : CANVAS_H / 2;
    const x = snapGrid(clamp(cx - defs.w / 2, 20, CANVAS_W - defs.w - 20));
    const y = snapGrid(clamp(cy - defs.h / 2, 20, CANVAS_H - defs.h - 20));
    const dec = addDecoration({ type, x, y, w: defs.w, h: defs.h, floor: activeFloor ?? undefined });
    setSelectedDec(dec.id);
    setSelectedTable(null);
    toast.success(`${defs.label} added`);
  }

  // ── Live stats ───────────────────────────────────────────────────────────────
  const available = tables.filter(t => t.status === 'available').length;
  const occupied  = tables.filter(t => t.status === 'occupied').length;
  const reserved  = tables.filter(t => t.status === 'reserved').length;

  const showInspector = selectedTableObj !== null;
  const showDecInspector = !showInspector && selectedDecObj !== null;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-3" style={{ height: 'calc(100vh - 7rem)' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 shrink-0">
          <div>
            <h1 className="font-display text-2xl font-bold">Floor Map</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {tables.length} table{tables.length !== 1 ? 's' : ''}
              {' · '}<span style={{ color: STATUS_COLOR.available }}>{available} free</span>
              {occupied > 0 && <> · <span style={{ color: STATUS_COLOR.occupied }}>{occupied} occupied</span></>}
              {reserved > 0 && <> · <span style={{ color: STATUS_COLOR.reserved }}>{reserved} reserved</span></>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex items-center gap-0.5 bg-muted rounded-xl p-1">
              <button
                onClick={switchToEdit}
                className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                  pageMode === 'edit' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Pencil className="w-3 h-3" /> Layout
              </button>
              <button
                onClick={switchToOperate}
                className={`flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                  pageMode === 'operate' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Eye className="w-3 h-3" /> Live
              </button>
            </div>

            {/* Edit-only controls */}
            {pageMode === 'edit' && (
              <>
                {zones.length > 0 && (
                  <button onClick={() => setZonesOpen(true)}
                    className="hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors text-muted-foreground">
                    Zones
                  </button>
                )}
                {/* Zoom controls */}
                <div className="hidden sm:flex items-center gap-0.5 bg-muted rounded-xl p-1">
                  <button onClick={fitView} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background text-muted-foreground transition-colors" title="Fit view">
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setScale(s => clamp(+(s - 0.1).toFixed(1), 0.4, 2))} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background text-muted-foreground transition-colors">
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
                  <button onClick={() => setScale(s => clamp(+(s + 0.1).toFixed(1), 0.4, 2))} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background text-muted-foreground transition-colors">
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Props button */}
                <div className="relative">
                  <button
                    onClick={() => setPropsOpen(p => !p)}
                    className={`hidden sm:flex items-center gap-1.5 h-9 px-3 rounded-xl border text-sm font-medium transition-colors ${
                      propsOpen ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted text-muted-foreground'
                    }`}
                    title="Add decor (plants, walls, art)"
                  >
                    <Flower2 className="w-3.5 h-3.5" /> Decor
                  </button>
                  <AnimatePresence>
                    {propsOpen && <PropsPalette onAdd={handleAddProp} onClose={() => setPropsOpen(false)} />}
                  </AnimatePresence>
                </div>

                <Button onClick={openAdd} className="gap-2">
                  <Plus className="w-4 h-4" /> Add Table
                </Button>
              </>
            )}
          </div>
        </div>

        {/* ── Operate mode: floor map + table panel ── */}
        {pageMode === 'operate' && (
          <div className="flex gap-3 flex-1 min-h-0">
            <div className="flex-1 min-w-0">
              <FloorMapCanvas
                tables={tables}
                decorations={decorations}
                orders={orders}
                selectedTableId={operationalTable?.id ?? null}
                onTableClick={t => setOperationalTable(prev => prev?.id === t.id ? null : t)}
              />
            </div>
            <AnimatePresence mode="wait">
              {operationalTable && (
                <TablePanel
                  key={operationalTable.id}
                  table={operationalTable}
                  orders={orders.filter(o =>
                    o.tableId === operationalTable.id &&
                    OP_STATUSES.includes(o.status),
                  )}
                  canAdvance={true}
                  canUpdateTableStatus={true}
                  onAdvance={handleAdminAdvance}
                  onClose={() => setOperationalTable(null)}
                  onClearTable={() => handleAdminClearTable(operationalTable)}
                  advancing={new Set<string>()}
                  variant="panel"
                  filterCategories={[]}
                  categoryMode={'all' as CategoryMode}
                  menuItems={menuItems}
                />
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Edit mode: floor selector + canvas + inspector ── */}
        {pageMode === 'edit' && (
          <>
        {/* ── Floor selector ── */}
        <FloorSelector
          floors={allFloors}
          active={activeFloor}
          tableCounts={floorTableCounts}
          onSelect={handleFloorSelect}
          onRename={handleFloorRename}
          onDelete={handleFloorDelete}
        />

        {/* ── Canvas + inspector ── */}
        <div className="flex gap-3 flex-1 min-h-0">

          {/* Canvas */}
          <div
            ref={containerRef}
            className="flex-1 overflow-auto rounded-2xl border border-border relative"
            style={{
              background: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              backgroundColor: 'hsl(var(--background))',
            }}
          >
            {visibleTables.length === 0 && visibleDecorations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-center p-8 pointer-events-none">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                  <QrCode className="w-8 h-8 text-muted-foreground" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {activeFloor ? `No tables on "${activeFloor}"` : 'No tables yet'}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {activeFloor ? 'Add a table and assign it to this floor' : 'Add your first table to start building your floor map'}
                  </p>
                </div>
                <Button variant="outline" className="gap-2 pointer-events-auto" onClick={openAdd}>
                  <Plus className="w-4 h-4" /> Add table
                </Button>
              </div>
            ) : (
              <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale, position: 'relative', minWidth: '100%', minHeight: '100%' }}>
                <div
                  style={{ position: 'absolute', inset: 0, transform: `scale(${scale})`, transformOrigin: '0 0', width: CANVAS_W, height: CANVAS_H, cursor: panRef.current ? 'grabbing' : 'grab' }}
                  onPointerDown={handleCanvasBgDown}
                  onPointerMove={handleCanvasBgMove}
                  onPointerUp={handleCanvasBgUp}
                >
                  {/* Zone backgrounds */}
                  {visibleZones.map(zone => {
                    const bounds = zoneBounds(visibleTables, zone);
                    if (!bounds) return null;
                    const zc = ZONE_PALETTE[zones.indexOf(zone) % ZONE_PALETTE.length];
                    return (
                      <div key={zone} style={{ position: 'absolute', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, backgroundColor: zc.fill, border: `1.5px dashed ${zc.border}`, borderRadius: 20, pointerEvents: 'none' }}>
                        <span className="absolute top-2 left-3 text-[11px] font-semibold tracking-wide uppercase select-none" style={{ color: zc.text }}>{zone}</span>
                      </div>
                    );
                  })}

                  {/* Decorations (rendered below tables) */}
                  {visibleDecorations.map(dec => {
                    const pos = getDecPos(dec);
                    const effectiveDec = resizeDecState?.id === dec.id
                      ? { ...dec, w: resizeDecState.w, h: resizeDecState.h }
                      : dec;
                    return (
                      <DecorationTile
                        key={dec.id}
                        decoration={effectiveDec}
                        x={pos.x} y={pos.y}
                        selected={selectedDec === dec.id}
                        dragging={dragDecState?.id === dec.id}
                        onPointerDown={e => handleDecPointerDown(e, dec)}
                        onPointerMove={e => handleDecPointerMove(e, dec)}
                        onPointerUp={e => handleDecPointerUp(e, dec)}
                        onResizeStart={e => handleDecResizeStart(e, dec)}
                        onResizeMove={e => handleDecResizeMove(e, dec)}
                        onResizeEnd={e => handleDecResizeEnd(e, dec)}
                      />
                    );
                  })}

                  {/* Table tiles */}
                  {visibleTables.map(table => {
                    const pos = getPos(table);
                    return (
                      <TableTile
                        key={table.id}
                        table={table}
                        x={pos.x} y={pos.y}
                        selected={selectedTable === table.id}
                        dragging={dragState?.id === table.id}
                        resizeSizeScale={resizeState?.id === table.id ? resizeState.sizeScale : null}
                        activeOrders={activeOrdersFor(table.id)}
                        onPointerDown={e => handlePointerDown(e, table)}
                        onPointerMove={e => handlePointerMove(e, table)}
                        onPointerUp={e => handlePointerUp(e, table)}
                        onResizeStart={e => handleResizeStart(e, table)}
                        onResizeMove={e => handleResizeMove(e, table)}
                        onResizeEnd={e => handleResizeEnd(e, table)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Inspector */}
          <AnimatePresence mode="wait">
            {showInspector && selectedTableObj && (
              <Inspector
                key={selectedTableObj.id}
                table={selectedTableObj}
                appUrl={appUrl}
                restaurantToken={settings.restaurantToken}
                activeOrders={activeOrdersFor(selectedTableObj.id)}
                onEdit={() => openEdit(selectedTableObj)}
                onDelete={() => handleDelete(selectedTableObj)}
                onStatusCycle={dir => setTableStatus(selectedTableObj.id, cycleStatus(selectedTableObj.status, dir))}
                onDeselect={() => setSelectedTable(null)}
                onOpenQr={() => setQrTable(selectedTableObj)}
                onRotate={() => updateTable(selectedTableObj.id, { rotation: (((selectedTableObj.rotation ?? 0) + 90) % 360) })}
              />
            )}
            {showDecInspector && selectedDecObj && (
              <DecorationInspector
                key={selectedDecObj.id}
                decoration={selectedDecObj}
                onDelete={() => { deleteDecoration(selectedDecObj.id); setSelectedDec(null); toast.success('Decoration removed'); }}
                onRotate={() => updateDecoration(selectedDecObj.id, { rotation: ((selectedDecObj.rotation + 90) % 360) })}
                onDeselect={() => setSelectedDec(null)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* ── Legend ── */}
        {(tables.length > 0 || decorations.length > 0) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
            {(Object.entries(STATUS_COLOR) as [TableStatus, string][]).map(([s, c]) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />{STATUS_LABEL[s]}
              </span>
            ))}
            <span className="ml-auto hidden sm:block opacity-50">Drag to move · Click to inspect · Drag grip to resize · Ctrl+scroll to zoom</span>
          </div>
        )}
          </>
        )}
      </div>

      {/* ── Dialogs ── */}
      <TableFormDialog
        open={formOpen}
        onOpenChange={o => { setFormOpen(o); if (!o) setEditTarget(null); }}
        table={editTarget}
        existingZones={zones}
        existingFloors={allFloors}
        defaultFloor={activeFloor ?? undefined}
        defaultName={addDefaultName}
        onSave={handleSave}
      />

      <ZonesDialog
        open={zonesOpen}
        onOpenChange={setZonesOpen}
        zones={zones}
        zoneColors={zoneColors}
        tableCounts={zoneTableCounts}
        onRename={handleZoneRename}
        onDelete={handleZoneDelete}
      />

      <AnimatePresence>
        {qrTable && (
          <QrSheet
            table={qrTable}
            url={getTableUrl(qrTable.id)}
            restaurantName={settings.businessName}
            onClose={() => setQrTable(null)}
          />
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
}
