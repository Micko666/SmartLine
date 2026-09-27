import type { MapDecoration } from '@/domain/types';
import { resizeGripPos } from './shared';
import DecorationSvg from './DecorationSvg';

// ─── DecorationTile ───────────────────────────────────────────────────────────

export default function DecorationTile({
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
