import { motion } from 'framer-motion';
import { Pencil, Trash2, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_PRESETS } from '@/domain/stations';
import type { Station } from '@/domain/types';
import { ROLE_ICONS } from './shared';

// ─── Station Card ─────────────────────────────────────────────────────────────

export default function StationCard({
  station,
  restaurantToken,
  onEdit,
  onDelete,
}: {
  station: Station;
  restaurantToken: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const Icon = ROLE_ICONS[station.role];
  const url = `${window.location.origin}/station/${restaurantToken}/${station.id}`;

  function copyUrl() {
    navigator.clipboard.writeText(url).then(() => toast.success('Station URL copied'));
  }

  const p = station.permissions;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: station.color + '22', color: station.color }}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-foreground truncate">{station.name}</p>
          <p className="text-xs text-muted-foreground capitalize">{ROLE_PRESETS[station.role].label}</p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Permission chips */}
      <div className="flex flex-wrap gap-1.5">
        {p.canAdvanceOrders && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 font-medium">Advance orders</span>
        )}
        {p.canCancelOrders && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-700 dark:text-red-400 font-medium">Cancel</span>
        )}
        {p.canLogKitchenEvents && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium">Kitchen events</span>
        )}
        {(p.canAdjustPrepTime ?? false) && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-700 dark:text-orange-400 font-medium">Adjust timing</span>
        )}
        {(p.canReworkOrders ?? false) && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-700 dark:text-purple-400 font-medium">Rework</span>
        )}
        {p.mapAccess && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium">Floor map</span>
        )}
        {p.canUpdateTableStatus && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-400 font-medium">Table control</span>
        )}
        {p.categoryMode !== 'all' && p.filterCategories && p.filterCategories.length > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">
            {p.categoryMode}: {p.filterCategories.join(', ')}
          </span>
        )}
        {(station.hasPin ?? !!station.pin) ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">PIN locked</span>
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 font-medium">No PIN</span>
        )}
      </div>

      {/* URL row */}
      <div className="flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
        <span className="text-xs text-muted-foreground font-mono flex-1 truncate">/station/…/{station.id.slice(0, 8)}</span>
        <button onClick={copyUrl} className="text-muted-foreground hover:text-foreground transition-colors">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </motion.div>
  );
}
