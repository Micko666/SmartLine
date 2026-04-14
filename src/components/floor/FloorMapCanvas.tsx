import { useState, useRef, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Layers, Users } from 'lucide-react';
import type { Table, MapDecoration, Order, DecorationType } from '@/domain/types';
import { getTableSize, ZONE_PALETTE, TABLE_STATUS_COLOR, CANVAS_W, CANVAS_H } from '@/domain/tables';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_COLOR = TABLE_STATUS_COLOR;

const ACTIVE_STATUSES = ['paid', 'preparing', 'ready'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

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
    const arm = Math.round(Math.min(w, h) * 0.45);
    const pts = `${2},${2} ${arm},${2} ${arm},${h - arm} ${w - 2},${h - arm} ${w - 2},${h - 2} ${2},${h - 2}`;
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

function DecorationSvg({ type, w, h }: { type: DecorationType; w: number; h: number }) {
  if (type === 'door') {
    const thick = Math.max(8, h * 0.18);
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <rect x={0} y={h - thick} width={thick} height={thick} fill="#94a3b8" rx={2} />
        <path
          d={`M ${thick / 2} ${h - thick} A ${h - thick} ${h - thick} 0 0 1 ${h - thick / 2} ${h}`}
          fill="rgba(148,163,184,0.12)" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3"
        />
        <line x1={thick / 2} y1={h - thick} x2={h - thick / 2} y2={h} stroke="#94a3b8" strokeWidth={1.5} />
      </svg>
    );
  }
  if (type === 'plant') {
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.28;
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <rect x={cx - r * 0.7} y={cy + r * 0.5} width={r * 1.4} height={r * 0.9} fill="#78716c" rx={3} />
        <circle cx={cx} cy={cy - r * 0.15} r={r} fill="#16a34a" />
        <circle cx={cx - r * 0.6} cy={cy + r * 0.1} r={r * 0.7} fill="#15803d" />
        <circle cx={cx + r * 0.6} cy={cy + r * 0.1} r={r * 0.7} fill="#15803d" />
        <circle cx={cx} cy={cy - r * 0.9} r={r * 0.55} fill="#22c55e" />
      </svg>
    );
  }
  if (type === 'pillar') {
    const r = Math.min(w, h) / 2 - 3, cx = w / 2, cy = h / 2;
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <circle cx={cx} cy={cy} r={r} fill="#cbd5e1" stroke="#94a3b8" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={r * 0.45} fill="#94a3b8" />
      </svg>
    );
  }
  if (type === 'window') {
    return (
      <svg width={w} height={h} className="pointer-events-none">
        <rect x={1} y={1} width={w - 2} height={h - 2} fill="rgba(147,197,253,0.25)" stroke="#60a5fa" strokeWidth={2} rx={2} />
        <line x1={w / 2} y1={1} x2={w / 2} y2={h - 1} stroke="#60a5fa" strokeWidth={1.5} />
        <line x1={1} y1={h / 2} x2={w - 1} y2={h / 2} stroke="#60a5fa" strokeWidth={1.5} />
      </svg>
    );
  }
  if (type === 'stairs') {
    const steps = 4, sw = (w - 4) / steps, sh = (h - 4) / steps;
    return (
      <svg width={w} height={h} className="pointer-events-none">
        {Array.from({ length: steps }).map((_, i) => (
          <rect key={i} x={2 + sw * i} y={2 + sh * i} width={sw * (steps - i)} height={sh}
            fill="rgba(148,163,184,0.18)" stroke="#94a3b8" strokeWidth={1} />
        ))}
      </svg>
    );
  }
  // wall
  return (
    <svg width={w} height={h} className="pointer-events-none">
      <rect x={0} y={0} width={w} height={h} fill="#94a3b8" rx={4} />
      <rect x={2} y={2} width={w - 4} height={h - 4} fill="rgba(203,213,225,0.6)" rx={2} />
    </svg>
  );
}

// ─── ReadOnlyTableTile ────────────────────────────────────────────────────────

function ReadOnlyTableTile({
  table, x, y, selected, readyOrders, activeOrders, onClick,
}: {
  table: Table; x: number; y: number; selected: boolean;
  readyOrders: number; activeOrders: number;
  onClick: () => void;
}) {
  const shape = table.shape ?? 'square';
  const { w, h } = getTableSize(shape, table.capacity, table.sizeScale ?? 1);
  const color = STATUS_COLOR[table.status];
  const isBar = shape === 'bar';
  const rotation = shape === 'l-shape' ? (table.rotation ?? 0) : 0;
  const numSize = w < 84 ? 'text-lg' : w < 108 ? 'text-xl' : 'text-2xl';

  return (
    <div
      onClick={onClick}
      style={{
        position: 'absolute', left: x, top: y, width: w, height: h,
        cursor: 'pointer', userSelect: 'none', touchAction: 'none',
        zIndex: selected ? 100 : 10,
        transition: 'filter 0.12s',
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
        filter: selected
          ? 'drop-shadow(0 0 0 2.5px #0d9488) drop-shadow(0 2px 8px rgba(13,148,136,0.18))'
          : 'none',
      }}
    >
      <TableShapeSvg
        shape={shape} w={w} h={h}
        fill={selected ? '#0d948822' : `${color}14`}
        stroke={selected ? '#0d9488' : `${color}50`}
        strokeWidth={selected ? 2.5 : 1.5}
      />

      {/* Ready badge — green pulse ring to catch attention */}
      {readyOrders > 0 && (
        <div className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-green-500 text-[9px] font-bold text-white flex items-center justify-center shadow z-20 ring-2 ring-background">
          {readyOrders}
        </div>
      )}

      {/* Active (non-ready) order badge — amber */}
      {readyOrders === 0 && activeOrders > 0 && (
        <div className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-amber-500 text-[9px] font-bold text-white flex items-center justify-center shadow z-20 ring-2 ring-background">
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
            <span className="text-[9px] text-muted-foreground/50 flex items-center gap-0.5">
              <Users className="w-2.5 h-2.5" />{table.capacity}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FloorMapCanvas ───────────────────────────────────────────────────────────

export interface FloorMapCanvasProps {
  tables: Table[];
  decorations: MapDecoration[];
  orders: Order[];
  selectedTableId?: string | null;
  onTableClick: (table: Table) => void;
}

export default function FloorMapCanvas({
  tables, decorations, orders, selectedTableId, onTableClick,
}: FloorMapCanvasProps) {
  // ── Floor tabs ───────────────────────────────────────────────────────────────
  const floors = [...new Set(tables.map(t => t.floor).filter(Boolean) as string[])];
  const [activeFloor, setActiveFloor] = useState<string | null>(null);

  useEffect(() => {
    if (floors.length > 0 && activeFloor === null) setActiveFloor(floors[0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors.length > 0]);

  const visibleTables = activeFloor ? tables.filter(t => t.floor === activeFloor) : tables;
  const visibleDecorations = activeFloor ? decorations.filter(d => d.floor === activeFloor) : decorations;

  // ── Zone data ────────────────────────────────────────────────────────────────
  const zones = [...new Set(tables.map(t => t.zone).filter(Boolean) as string[])];
  const visibleZones = [...new Set(visibleTables.map(t => t.zone).filter(Boolean) as string[])];
  const zoneColors: Record<string, typeof ZONE_PALETTE[0]> = {};
  zones.forEach((z, i) => { zoneColors[z] = ZONE_PALETTE[i % ZONE_PALETTE.length]; });

  // ── Order counts per table ───────────────────────────────────────────────────
  function activeOrdersFor(tableId: string) {
    return orders.filter(o => o.tableId === tableId && ACTIVE_STATUSES.includes(o.status)).length;
  }
  function readyOrdersFor(tableId: string) {
    return orders.filter(o => o.tableId === tableId && o.status === 'ready').length;
  }

  // ── Scale & canvas ───────────────────────────────────────────────────────────
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale(s => clamp(+(s - e.deltaY * 0.001).toFixed(2), 0.25, 2.0));
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
      minX = Math.min(minX, t.x!); minY = Math.min(minY, t.y!);
      maxX = Math.max(maxX, t.x! + w); maxY = Math.max(maxY, t.y! + h);
    }
    const pad = 60;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const newScale = clamp(Math.min(cw / (maxX - minX + pad * 2), ch / (maxY - minY + pad * 2)), 0.25, 1.5);
    setScale(newScale);
    setTimeout(() => {
      containerRef.current?.scrollTo({ left: (minX - pad) * newScale, top: (minY - pad) * newScale, behavior: 'smooth' });
    }, 50);
  }

  // ── Canvas pan ───────────────────────────────────────────────────────────────
  const panRef = useRef<{ startX: number; startY: number; sl: number; st: number } | null>(null);

  function handleCanvasBgDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, sl: containerRef.current?.scrollLeft ?? 0, st: containerRef.current?.scrollTop ?? 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleCanvasBgMove(e: React.PointerEvent) {
    if (!panRef.current) return;
    containerRef.current!.scrollLeft = panRef.current.sl + (panRef.current.startX - e.clientX);
    containerRef.current!.scrollTop  = panRef.current.st  + (panRef.current.startY - e.clientY);
  }
  function handleCanvasBgUp() { panRef.current = null; }

  return (
    <div className="flex flex-col h-full gap-2">

      {/* ── Top bar: floor tabs + zoom ── */}
      <div className="flex items-center gap-2 shrink-0 flex-wrap">
        {/* Floor tabs */}
        {floors.length > 0 && (
          <div className="flex items-center gap-1 bg-muted rounded-xl p-1">
            {floors.length > 1 && (
              <button
                onClick={() => setActiveFloor(null)}
                className={`flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                  activeFloor === null ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >All</button>
            )}
            {floors.map(f => (
              <button key={f}
                onClick={() => setActiveFloor(f)}
                className={`flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-medium transition-colors ${
                  activeFloor === f ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Layers className="w-3 h-3 opacity-60" />{f}
              </button>
            ))}
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 bg-muted rounded-xl p-1">
          <button onClick={fitView} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background text-muted-foreground transition-colors" title="Fit view">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setScale(s => clamp(+(s - 0.1).toFixed(1), 0.25, 2))} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background text-muted-foreground transition-colors">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-medium text-muted-foreground w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => clamp(+(s + 0.1).toFixed(1), 0.25, 2))} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-background text-muted-foreground transition-colors">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto rounded-2xl border border-border relative"
        style={{
          background: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
          backgroundColor: 'hsl(var(--background))',
        }}
      >
        {visibleTables.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No tables on this floor
          </div>
        ) : (
          <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale, position: 'relative', minWidth: '100%', minHeight: '100%' }}>
            <div
              style={{
                position: 'absolute', inset: 0,
                transform: `scale(${scale})`, transformOrigin: '0 0',
                width: CANVAS_W, height: CANVAS_H,
                cursor: panRef.current ? 'grabbing' : 'grab',
              }}
              onPointerDown={handleCanvasBgDown}
              onPointerMove={handleCanvasBgMove}
              onPointerUp={handleCanvasBgUp}
            >
              {/* Zone backgrounds */}
              {visibleZones.map(zone => {
                const bounds = zoneBounds(visibleTables, zone);
                if (!bounds) return null;
                const zc = zoneColors[zone];
                return (
                  <div key={zone} style={{
                    position: 'absolute', left: bounds.left, top: bounds.top,
                    width: bounds.width, height: bounds.height,
                    backgroundColor: zc.fill, border: `1.5px dashed ${zc.border}`,
                    borderRadius: 20, pointerEvents: 'none',
                  }}>
                    <span className="absolute top-2 left-3 text-[11px] font-semibold tracking-wide uppercase select-none" style={{ color: zc.text }}>{zone}</span>
                  </div>
                );
              })}

              {/* Decorations */}
              {visibleDecorations.map(dec => (
                <div key={dec.id} style={{
                  position: 'absolute', left: dec.x, top: dec.y, width: dec.w, height: dec.h,
                  transform: dec.rotation ? `rotate(${dec.rotation}deg)` : undefined,
                  transformOrigin: 'center center', opacity: 0.82, pointerEvents: 'none',
                }}>
                  <DecorationSvg type={dec.type} w={dec.w} h={dec.h} />
                </div>
              ))}

              {/* Tables */}
              {visibleTables.map(table => (
                <ReadOnlyTableTile
                  key={table.id}
                  table={table}
                  x={table.x ?? 60}
                  y={table.y ?? 60}
                  selected={selectedTableId === table.id}
                  readyOrders={readyOrdersFor(table.id)}
                  activeOrders={activeOrdersFor(table.id)}
                  onClick={() => onTableClick(table)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
        {(Object.entries(STATUS_COLOR) as [TableStatus, string][]).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </span>
        ))}
        <span className="flex items-center gap-1.5 ml-2">
          <span className="w-2 h-2 rounded-full bg-green-500" /> Ready orders
        </span>
        <span className="ml-auto opacity-50 hidden sm:block">Click a table to see its orders</span>
      </div>
    </div>
  );
}
