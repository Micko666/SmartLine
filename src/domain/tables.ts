/**
 * Shared table geometry and visual constants.
 * Single source of truth — used by FloorMapCanvas (read-only) and
 * the Tables admin page (edit mode). Keep in sync with DB column types.
 */

import type { TableShape, TableStatus } from './types';

// ─── Canvas dims (shared between edit and read-only canvases) ─────────────────

export const CANVAS_W = 1600;
export const CANVAS_H = 960;

// ─── Table sizing ─────────────────────────────────────────────────────────────

/** Capacity-aware table dimensions. sizeScale = 1.0 is default. */
export function getTableSize(
  shape: TableShape,
  capacity: number,
  sizeScale = 1,
): { w: number; h: number } {
  let base: { w: number; h: number };
  if (shape === 'bar') {
    base = { w: Math.max(160, Math.min(320, 100 + capacity * 20)), h: 64 };
  } else if (shape === 'round' || shape === 'l-shape') {
    if (capacity <= 2)      base = { w: 72,  h: 72  };
    else if (capacity <= 4) base = { w: 96,  h: 96  };
    else if (capacity <= 6) base = { w: 114, h: 114 };
    else if (capacity <= 8) base = { w: 132, h: 132 };
    else                    base = { w: 152, h: 152 };
  } else {
    if (capacity <= 2)      base = { w: 96,  h: 64  };
    else if (capacity <= 4) base = { w: 120, h: 80  };
    else if (capacity <= 6) base = { w: 144, h: 88  };
    else if (capacity <= 8) base = { w: 168, h: 96  };
    else                    base = { w: 192, h: 108 };
  }
  return { w: Math.round(base.w * sizeScale), h: Math.round(base.h * sizeScale) };
}

// ─── Status visuals ───────────────────────────────────────────────────────────

export const TABLE_STATUS_COLOR: Record<TableStatus, string> = {
  available: '#16a34a',
  occupied:  '#f97316',
  reserved:  '#3b82f6',
};

export const TABLE_STATUS_LABEL: Record<TableStatus, string> = {
  available: 'Available',
  occupied:  'Occupied',
  reserved:  'Reserved',
};

/** Operational status cycle for click-to-toggle in the editor. */
export const TABLE_STATUS_CYCLE: TableStatus[] = ['available', 'reserved', 'occupied'];

// ─── Zone palette ─────────────────────────────────────────────────────────────

export const ZONE_PALETTE = [
  { fill: 'rgba(99,102,241,0.06)',  border: 'rgba(99,102,241,0.22)',  text: '#6366f1' },
  { fill: 'rgba(16,185,129,0.06)',  border: 'rgba(16,185,129,0.22)',  text: '#059669' },
  { fill: 'rgba(245,158,11,0.06)',  border: 'rgba(245,158,11,0.22)',  text: '#d97706' },
  { fill: 'rgba(239,68,68,0.06)',   border: 'rgba(239,68,68,0.22)',   text: '#dc2626' },
  { fill: 'rgba(59,130,246,0.06)',  border: 'rgba(59,130,246,0.22)',  text: '#2563eb' },
  { fill: 'rgba(168,85,247,0.06)',  border: 'rgba(168,85,247,0.22)',  text: '#9333ea' },
  { fill: 'rgba(236,72,153,0.06)',  border: 'rgba(236,72,153,0.22)',  text: '#db2777' },
];
