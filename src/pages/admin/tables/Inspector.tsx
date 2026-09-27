import { useRef } from 'react';
import { Trash2, Download, ExternalLink, X, Copy, Pencil, ChevronLeft, ChevronRight, Layers, RotateCw } from 'lucide-react';
import { motion } from 'framer-motion';
import QRCode from 'react-qr-code';
import type { Table } from '@/domain/types';
import { toast } from 'sonner';
import { STATUS_COLOR, STATUS_LABEL, makeQrDownloader } from './shared';

// ─── Inspector ────────────────────────────────────────────────────────────────

export default function Inspector({
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
