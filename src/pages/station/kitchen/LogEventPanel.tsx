import { useState } from 'react';
import { motion } from 'framer-motion';
import { type KitchenEventType } from '@/lib/supabase/realtime/useStationOrders';
import { LOG_TYPES } from './shared';

export default function LogEventPanel({
  onLog, onClose,
}: {
  onLog: (type: KitchenEventType, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<KitchenEventType>('note');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!notes.trim()) return;
    setBusy(true);
    await onLog(type, notes.trim());
    setBusy(false);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="pt-1 space-y-2 border-t border-border/60">
        <div className="flex gap-1 pt-2">
          {LOG_TYPES.map(ev => (
            <button key={ev.value} onClick={() => setType(ev.value)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                type === ev.value ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {ev.label}
            </button>
          ))}
        </div>
        <textarea
          autoFocus rows={2}
          placeholder={type === 'remake' ? 'What needs to be redone?' : type === 'delay' ? 'Reason for delay…' : 'Add a note…'}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring/20 leading-snug"
        />
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={!notes.trim() || busy}
            className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 transition-all active:scale-95"
          >
            {busy ? '…' : type === 'remake' ? 'Send Back to Kitchen' : 'Log'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}
