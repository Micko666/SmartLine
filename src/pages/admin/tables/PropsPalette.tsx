import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DecorationType } from '@/domain/types';
import { PROP_PALETTE } from './shared';

export default function PropsPalette({ onAdd, onClose }: { onAdd: (type: DecorationType) => void; onClose: () => void }) {
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
