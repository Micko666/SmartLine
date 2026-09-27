import { useState } from 'react';
import { X } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Order, KitchenEventType } from '@/domain/types';
import { EVENT_TYPE_CONFIG } from './shared';

export default function KitchenEventModal({ order, sym, onSave, onClose }: {
  order: Order;
  sym: string;
  onSave: (
    type: KitchenEventType,
    notes: string,
    menuItemId?: string,
    menuItemName?: string,
    quantity?: number,
    estimatedCost?: number,
  ) => void;
  onClose: () => void;
}) {
  const [type,          setType]          = useState<KitchenEventType>('waste');
  const [notes,         setNotes]         = useState('');
  const [selectedItem,  setSelectedItem]  = useState('');
  const [quantity,      setQuantity]      = useState<number | undefined>(undefined);
  const [estimatedCost, setEstimatedCost] = useState<number | undefined>(undefined);

  const selectedOrderItem = order.items.find(i => i.menuItemId === selectedItem);

  const handleSave = () => {
    if (!notes.trim() && type !== 'note') {
      return; // silently require notes for non-notes
    }
    onSave(
      type,
      notes.trim() || `${EVENT_TYPE_CONFIG[type].label} logged`,
      selectedItem || undefined,
      selectedOrderItem?.menuItemName,
      quantity,
      estimatedCost,
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-foreground/20 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 28 }} onClick={e => e.stopPropagation()}
        className="glass-card-solid w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-display text-base font-bold">Log Kitchen Event</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Order #{order.orderNumber} · {order.tableName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="w-5 h-5" /></button>
        </div>

        {/* Event type */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {(Object.entries(EVENT_TYPE_CONFIG) as [KitchenEventType, typeof EVENT_TYPE_CONFIG[KitchenEventType]][]).map(([key, cfg]) => (
            <button
              key={key} onClick={() => setType(key)}
              className={`p-3 rounded-xl border text-left transition-colors ${type === key ? cfg.color + ' border-current' : 'border-border bg-muted/20 hover:bg-muted/40'}`}
            >
              <p className="text-sm font-semibold">{cfg.label}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{cfg.desc}</p>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* Which item */}
          <div>
            <label className="text-xs font-medium mb-1 block">Item (optional)</label>
            <select
              value={selectedItem} onChange={e => setSelectedItem(e.target.value)}
              className="w-full h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none"
            >
              <option value="">All / general</option>
              {order.items.map(i => (
                <option key={i.menuItemId} value={i.menuItemId}>{i.menuItemName}</option>
              ))}
            </select>
          </div>

          {/* Quantity + estimated cost */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium mb-1 block">Quantity</label>
              <input
                type="number" min="1" value={quantity ?? ''}
                onChange={e => setQuantity(e.target.value === '' ? undefined : parseInt(e.target.value) || 1)}
                placeholder="—"
                className="w-full h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-medium mb-1 block">Est. Cost ({sym})</label>
              <input
                type="number" step="0.01" min="0" value={estimatedCost ?? ''}
                onChange={e => setEstimatedCost(e.target.value === '' ? undefined : parseFloat(e.target.value) || 0)}
                placeholder="—"
                className="w-full h-9 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium mb-1 block">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="What happened? Be specific for better analytics."
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-input bg-background text-sm focus:outline-none resize-none"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 h-10 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
          <button onClick={handleSave} className="flex-1 h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            Log Event
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
