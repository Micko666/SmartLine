/** Shared constants/helpers extracted from Tables.tsx (behavior-preserving split). */
import { Flower2, DoorOpen, Columns3, AppWindow, Footprints, Minus } from 'lucide-react';
import type { Table, TableShape, TableStatus, DecorationType } from '@/domain/types';
import { getTableSize, TABLE_STATUS_COLOR, TABLE_STATUS_LABEL, TABLE_STATUS_CYCLE } from '@/domain/tables';
import { toast } from 'sonner';


// ─── Constants ────────────────────────────────────────────────────────────────

export const CANVAS_W = 1600;

export const CANVAS_H = 960;

export const GRID = 20;

export const STATUS_COLOR = TABLE_STATUS_COLOR;

export const STATUS_LABEL = TABLE_STATUS_LABEL;

export const STATUS_CYCLE = TABLE_STATUS_CYCLE;

export const SHAPE_OPTIONS: { value: TableShape; label: string }[] = [
  { value: 'square',  label: 'Rectangle' },
  { value: 'round',   label: 'Round'     },
  { value: 'l-shape', label: 'L-Shape'   },
  { value: 'bar',     label: 'Bar'       },
];

export const CAPACITY_PRESETS = [1, 2, 3, 4, 5, 6, 8, 10, 12];

// ─── Decoration config ────────────────────────────────────────────────────────

export const DECORATION_DEFAULTS: Record<DecorationType, { w: number; h: number; label: string }> = {
  door:    { w: 60, h: 60,  label: 'Door'    },
  plant:   { w: 48, h: 48,  label: 'Plant'   },
  pillar:  { w: 40, h: 40,  label: 'Pillar'  },
  window:  { w: 80, h: 24,  label: 'Window'  },
  stairs:  { w: 80, h: 80,  label: 'Stairs'  },
  wall:    { w: 120, h: 20, label: 'Wall'    },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function snapGrid(v: number) { return Math.round(v / GRID) * GRID; }

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

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
export function resizeGripPos(rotation: number): React.CSSProperties {
  const r = ((rotation % 360) + 360) % 360;
  if (r === 90)  return { position: 'absolute', top:    -8, right:  -8 };
  if (r === 180) return { position: 'absolute', top:    -8, left:   -8 };
  if (r === 270) return { position: 'absolute', bottom: -8, left:   -8 };
  return               { position: 'absolute', bottom: -8, right:  -8 };
}

export function cycleStatus(current: TableStatus, dir: 1 | -1): TableStatus {
  const i = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[((i + dir) + STATUS_CYCLE.length) % STATUS_CYCLE.length];
}

export function zoneBounds(tables: Table[], zone: string, padding = 32) {
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

export function computeAutoPositions(tables: Table[]): Record<string, { x: number; y: number }> {
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

export function makeQrDownloader(qrRef: React.RefObject<HTMLDivElement>, fileName: string) {
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

// ─── Decoration Inspector ─────────────────────────────────────────────────────

export const DEC_ICONS: Record<DecorationType, React.ElementType> = {
  door:   DoorOpen,
  plant:  Flower2,
  pillar: Columns3,
  window: AppWindow,
  stairs: Footprints,
  wall:   Minus,
};

// ─── TableFormDialog ──────────────────────────────────────────────────────────

export interface TableFormData { name: string; capacity: number; shape: TableShape; zone: string; floor: string; }

// ─── Props Palette ────────────────────────────────────────────────────────────

export const PROP_PALETTE: { type: DecorationType; label: string; Icon: React.ElementType }[] = [
  { type: 'door',   label: 'Door',   Icon: DoorOpen   },
  { type: 'plant',  label: 'Plant',  Icon: Flower2    },
  { type: 'pillar', label: 'Pillar', Icon: Columns3   },
  { type: 'window', label: 'Window', Icon: AppWindow  },
  { type: 'stairs', label: 'Stairs', Icon: Footprints },
  { type: 'wall',   label: 'Wall',   Icon: Minus      },
];
