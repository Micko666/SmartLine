import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { WeeklyShiftSlot, WeeklyDayTemplate } from '@/domain/types';
import { PRESET_COLORS, DAY_LABELS, DISPLAY_DOW } from './shared';

export default function WeekTemplateEditor({ template, onSave, onClose }: {
  template: WeeklyDayTemplate[];
  onSave: (t: WeeklyDayTemplate[]) => void;
  onClose: () => void;
}) {
  // Local mutable copy
  const [tpl, setTpl] = useState<WeeklyDayTemplate[]>(() => {
    // Ensure all 7 days are present
    return DISPLAY_DOW.map(dow => template.find(d => d.dayOfWeek === dow) ?? { dayOfWeek: dow, slots: [] });
  });

  // Per-day "add slot" form state
  const [addingDow, setAddingDow] = useState<number | null>(null);
  const [newSlot, setNewSlot] = useState({ name: '', startTime: '09:00', endTime: '17:00', color: PRESET_COLORS[0], minStaff: 1 });

  function updateDay(dow: number, slots: WeeklyShiftSlot[]) {
    setTpl(prev => prev.map(d => d.dayOfWeek === dow ? { ...d, slots } : d));
  }

  function removeSlot(dow: number, slotId: string) {
    const day = tpl.find(d => d.dayOfWeek === dow);
    if (!day) return;
    updateDay(dow, day.slots.filter(s => s.id !== slotId));
  }

  function addSlot(dow: number) {
    if (!newSlot.name.trim()) return;
    const day = tpl.find(d => d.dayOfWeek === dow);
    if (!day) return;
    updateDay(dow, [...day.slots, { id: crypto.randomUUID(), name: newSlot.name.trim(), startTime: newSlot.startTime, endTime: newSlot.endTime, color: newSlot.color, minStaff: newSlot.minStaff }]);
    setNewSlot(s => ({ ...s, name: '' }));
    setAddingDow(null);
  }

  function copyToWholeWeek(dow: number) {
  const sourceDay = tpl.find(d => d.dayOfWeek === dow);
  if (!sourceDay) return;

  setTpl(prev =>
    prev.map(d => ({
      ...d,
      slots: sourceDay.slots.map(s => ({
        ...s,
        id: crypto.randomUUID(),
      })),
    }))
  );

  toast.success('Copied to whole week');
}

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Define your default weekly shift structure. These are just templates — click <strong>Apply to week</strong> in the roster to stamp them out as actual shifts.
      </p>
      <div className="space-y-2">
        {DISPLAY_DOW.map((dow, idx) => {
          const day = tpl.find(d => d.dayOfWeek === dow)!;
          const isOpen = addingDow === dow;
          return (
            <div key={dow} className="rounded-xl border border-border bg-muted/20 overflow-hidden">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="text-xs font-bold text-muted-foreground w-7 shrink-0">{DAY_LABELS[idx]}</span>
                <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                  {day.slots.length === 0 && <span className="text-xs text-muted-foreground/60 italic">Day off</span>}
                  {day.slots.map(slot => (
                    <span key={slot.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-white px-2 py-0.5 rounded-lg"
                      style={{ backgroundColor: slot.color }}>
                      {slot.name} <span className="opacity-75">{slot.startTime}–{slot.endTime}</span>
                      <button type="button" onClick={() => removeSlot(dow, slot.id)} className="ml-0.5 hover:opacity-70">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {day.slots.length > 0 && (
  <button
    type="button"
    onClick={() => copyToWholeWeek(dow)}
    title="Use this day's shifts for every other day of the week"
    className="text-[10px] text-muted-foreground hover:text-primary px-1.5 py-0.5 rounded hover:bg-primary/10 transition-colors"
  >
    Copy to all days
  </button>
)}
                  <button type="button" onClick={() => setAddingDow(isOpen ? null : dow)}
                    className={`p-1.5 rounded-lg transition-colors ${isOpen ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-border bg-card px-3 py-3 space-y-3">
                  <div className="flex gap-2 items-end flex-wrap">
                    <div className="flex-1 min-w-[120px]">
                      <label className="form-label">Shift name</label>
                      <input type="text" value={newSlot.name} onChange={e => setNewSlot(s => ({...s, name: e.target.value}))}
                        className="input-field w-full" placeholder="Morning, Evening…" autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSlot(dow); } }} />
                    </div>
                    <div>
                      <label className="form-label">Start</label>
                      <input type="time" value={newSlot.startTime} onChange={e => setNewSlot(s => ({...s, startTime: e.target.value}))} className="input-field" />
                    </div>
                    <div>
                      <label className="form-label">End</label>
                      <input type="time" value={newSlot.endTime} onChange={e => setNewSlot(s => ({...s, endTime: e.target.value}))} className="input-field" />
                    </div>
                    <div>
                      <label className="form-label">Min staff</label>
                      <input type="number" min={1} max={20} value={newSlot.minStaff} onChange={e => setNewSlot(s => ({...s, minStaff: Number(e.target.value)}))} className="input-field w-16" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5 flex-wrap flex-1">
                      {PRESET_COLORS.map(c => (
                        <button key={c} type="button" onClick={() => setNewSlot(s => ({...s, color: c}))}
                          className={`w-6 h-6 rounded-lg border-2 transition-all ${newSlot.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <button type="button" onClick={() => addSlot(dow)} className="btn-primary text-sm px-3 py-1.5 shrink-0">
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="button" onClick={() => { onSave(tpl); onClose(); }} className="btn-primary flex-1">Save default week</button>
      </div>
    </div>
  );
}
