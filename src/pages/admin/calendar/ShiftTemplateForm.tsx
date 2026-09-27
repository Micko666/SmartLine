import { useState } from 'react';
import type { ShiftTemplate } from '@/domain/types';
import { PRESET_COLORS } from './shared';

// ─── Shift template form ───────────────────────────────────────────────────────

export default function ShiftTemplateForm({ initial, onSave, onClose }: {
  initial?: ShiftTemplate;
  onSave: (data: Omit<ShiftTemplate, 'id'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', startTime: initial?.startTime ?? '09:00',
    endTime: initial?.endTime ?? '17:00', role: initial?.role ?? '', color: initial?.color ?? PRESET_COLORS[0],
  });
  return (
    <form onSubmit={e => { e.preventDefault(); if (!form.name.trim()) return; onSave(form); }} className="space-y-4">
      <div>
        <label className="form-label">Template name *</label>
        <input type="text" required value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input-field w-full" placeholder="Morning, Kitchen AM, Bar PM…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Start</label>
          <input type="time" value={form.startTime} onChange={e => setForm(f => ({...f, startTime: e.target.value}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">End</label>
          <input type="time" value={form.endTime} onChange={e => setForm(f => ({...f, endTime: e.target.value}))} className="input-field w-full" />
        </div>
      </div>
      <div>
        <label className="form-label">Color</label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setForm(f => ({...f, color: c}))}
              className={`w-8 h-8 rounded-xl border-2 transition-all ${form.color === c ? 'border-foreground scale-110 shadow-md' : 'border-transparent'}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <div className="p-3 rounded-xl bg-muted/30 border border-border">
        <p className="text-[10px] text-muted-foreground mb-1">Preview</p>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-white" style={{ backgroundColor: form.color }}>
          {form.name || 'Template'} <span className="opacity-75">{form.startTime}–{form.endTime}</span>
        </span>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="submit" className="btn-primary flex-1">Save template</button>
      </div>
    </form>
  );
}
