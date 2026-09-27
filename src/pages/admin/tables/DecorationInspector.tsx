import { Trash2, X, RotateCw } from 'lucide-react';
import { motion } from 'framer-motion';
import type { MapDecoration } from '@/domain/types';
import { DECORATION_DEFAULTS, DEC_ICONS } from './shared';

export default function DecorationInspector({
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
