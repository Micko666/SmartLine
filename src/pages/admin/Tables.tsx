import { useEffect, useRef, useState } from 'react';
import { Plus, QrCode, Pencil, ZoomIn, ZoomOut, Maximize2, Flower2, Eye } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import FloorMapCanvas from '@/components/floor/FloorMapCanvas';
import TablePanel from '@/components/station/TablePanel';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { Table, TableShape, TableStatus, MapDecoration, DecorationType, Order, CategoryMode } from '@/domain/types';
import { getTableSize, ZONE_PALETTE } from '@/domain/tables';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CANVAS_W, CANVAS_H, STATUS_COLOR, STATUS_LABEL, DECORATION_DEFAULTS, snapGrid, clamp, cycleStatus, zoneBounds, computeAutoPositions, TableFormData } from './tables/shared';
import TableTile from './tables/TableTile';
import DecorationTile from './tables/DecorationTile';
import Inspector from './tables/Inspector';
import DecorationInspector from './tables/DecorationInspector';
import QrSheet from './tables/QrSheet';
import TableFormDialog from './tables/TableFormDialog';
import ZonesDialog from './tables/ZonesDialog';
import FloorSelector from './tables/FloorSelector';
import PropsPalette from './tables/PropsPalette';

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
    orders.filter(o => o.tableId === id && ['placed', 'preparing', 'ready'].includes(o.status)).length;

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

  function handlePointerUp(_e: React.PointerEvent, table: Table) {
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

  function handleDecPointerUp(_e: React.PointerEvent, dec: MapDecoration) {
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
  const OP_STATUSES = ['placed', 'preparing', 'ready'];

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
