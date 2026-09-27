import { Users } from 'lucide-react';
import type { Table } from '@/domain/types';
import { getTableSize } from '@/domain/tables';
import { STATUS_COLOR, resizeGripPos } from './shared';
import TableShapeSvg from './TableShapeSvg';

// ─── TableTile ────────────────────────────────────────────────────────────────

export default function TableTile({
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
