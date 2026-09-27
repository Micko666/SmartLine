import { useState } from 'react';
import { Plus, X, Info } from 'lucide-react';
import { toast } from 'sonner';
import type { Employee, Shift, ShiftAssignment, ShiftTemplate } from '@/domain/types';
import { today, initials, shiftHours, PRESET_COLORS } from './shared';

// ─── Shift form ───────────────────────────────────────────────────────────────

export default function ShiftForm({ initial, initialDate, employees, stations, templates, onSave, onClose }: {
  initial?: Shift;
  initialDate?: string;
  employees: Employee[];
  stations: { id: string; name: string; color: string }[];
  templates?: ShiftTemplate[];
  onSave: (data: Omit<Shift, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    date:      initial?.date      ?? initialDate ?? today(),
    name:      initial?.name      ?? '',
    startTime: initial?.startTime ?? '09:00',
    endTime:   initial?.endTime   ?? '17:00',
    color:     initial?.color     ?? PRESET_COLORS[0],
    stationId: initial?.stationId ?? '',
    minStaff:  initial?.minStaff  ?? 1,
    notes:     initial?.notes     ?? '',
  });
  const [assignments, setAssignments] = useState<ShiftAssignment[]>(initial?.assignments ?? []);
  const [newEmpId, setNewEmpId] = useState('');
  const [newRole, setNewRole]   = useState('');
  const [newNote, setNewNote]   = useState('');

  const activeEmployees = employees.filter(e => e.active);
  const assignedIds     = new Set(assignments.map(a => a.employeeId));
  const availableEmps   = activeEmployees.filter(e => !assignedIds.has(e.id));

  function addAssignment() {
    if (!newEmpId) { toast.error('Pick an employee'); return; }
    const emp = employees.find(e => e.id === newEmpId);
    setAssignments(prev => [...prev, { employeeId: newEmpId, role: newRole.trim() || emp?.role || 'Staff', roleNote: newNote.trim() || undefined }]);
    setNewEmpId(''); setNewRole(''); setNewNote('');
  }

  function removeAssignment(idx: number) {
    setAssignments(prev => prev.filter((_, i) => i !== idx));
  }

  function updateAssignment(idx: number, field: keyof ShiftAssignment, value: string) {
    setAssignments(prev => prev.map((a, i) => i === idx ? { ...a, [field]: value || undefined } : a));
  }

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!form.name.trim()) { toast.error('Shift name required'); return; }
      onSave({ ...form, stationId: form.stationId || undefined, name: form.name.trim(), notes: form.notes.trim(), assignments });
    }} className="space-y-5">

      {/* Templates */}
      {(templates?.length ?? 0) > 0 && (
        <div>
          <label className="form-label">Quick templates</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {templates!.map(t => (
              <button key={t.id} type="button"
                onClick={() => setForm(f => ({ ...f, name: t.name, startTime: t.startTime, endTime: t.endTime, color: t.color }))}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-white hover:opacity-80"
                style={{ backgroundColor: t.color }}>
                {t.name} <span className="opacity-75">{t.startTime}–{t.endTime}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Name + color */}
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="form-label">Shift name *</label>
          <input type="text" required value={form.name}
            onChange={e => setForm(f => ({...f, name: e.target.value}))}
            className="input-field w-full" placeholder="Morning, Evening, Bar PM…" />
        </div>
        <div>
          <label className="form-label">Color</label>
          <div className="flex gap-1.5 flex-wrap max-w-[168px]">
            {PRESET_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setForm(f => ({...f, color: c}))}
                className={`w-7 h-7 rounded-lg border-2 transition-all ${form.color === c ? 'border-foreground scale-110 shadow' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      </div>

      {/* Date + times */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="form-label">Date</label>
          <input type="date" required value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">Start</label>
          <input type="time" value={form.startTime} onChange={e => setForm(f => ({...f, startTime: e.target.value}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">End</label>
          <input type="time" value={form.endTime} onChange={e => setForm(f => ({...f, endTime: e.target.value}))} className="input-field w-full" />
        </div>
      </div>

      {/* Station */}
      {stations.length > 0 && (
        <div>
          <label className="form-label">Station (optional)</label>
          <select value={form.stationId} onChange={e => setForm(f => ({...f, stationId: e.target.value}))} className="input-field w-full">
            <option value="">No station</option>
            {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {/* Staff assignments */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="form-label mb-0">Staff assignments</label>
          <span className="text-xs text-muted-foreground">{assignments.length} assigned · min {form.minStaff}</span>
        </div>
        {assignments.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {assignments.map((a, idx) => {
              const emp = employees.find(e => e.id === a.employeeId);
              return (
                <div key={idx} className="flex items-center gap-2 p-2 rounded-xl bg-muted/30 border border-border">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: emp?.color ?? '#64748b' }}>
                    {emp ? initials(emp.name) : '?'}
                  </div>
                  <span className="text-sm font-medium w-24 shrink-0 truncate">{emp?.name ?? 'Unknown'}</span>
                  <input type="text" value={a.role} onChange={e => updateAssignment(idx, 'role', e.target.value)}
                    className="input-field py-1 text-xs flex-1 min-w-0" placeholder="Role…" />
                  <input type="text" value={a.roleNote ?? ''} onChange={e => updateAssignment(idx, 'roleNote', e.target.value)}
                    className="input-field py-1 text-xs flex-1 min-w-0 hidden sm:block" placeholder="Split note…" />
                  <button type="button" onClick={() => removeAssignment(idx)}
                    className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {availableEmps.length > 0 ? (
          <div className="flex items-center gap-2 p-2 rounded-xl border border-dashed border-border bg-muted/10">
            <select value={newEmpId} onChange={e => {
              setNewEmpId(e.target.value);
              const emp = employees.find(x => x.id === e.target.value);
              if (emp?.role && !newRole) setNewRole(emp.role);
            }} className="input-field py-1 text-xs flex-1 min-w-0">
              <option value="">Pick employee…</option>
              {availableEmps.map(e => <option key={e.id} value={e.id}>{e.name}{e.role ? ` (${e.role})` : ''}</option>)}
            </select>
            <input type="text" value={newRole} onChange={e => setNewRole(e.target.value)}
              className="input-field py-1 text-xs flex-1 min-w-0" placeholder="Role…" />
            <input type="text" value={newNote} onChange={e => setNewNote(e.target.value)}
              className="input-field py-1 text-xs flex-1 min-w-0 hidden sm:block" placeholder="Split note…" />
            <button type="button" onClick={addAssignment}
              className="p-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : activeEmployees.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Add employees first.</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">All active employees assigned.</p>
        )}
        <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
          <Info className="w-3 h-3 shrink-0" />
          Split note: e.g. "07–10 prep cook, rest line cook"
        </p>
      </div>

      {/* Min staff + notes */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Min. staff required</label>
          <input type="number" min={0} max={50} value={form.minStaff} onChange={e => setForm(f => ({...f, minStaff: Number(e.target.value)}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">Shift hours</label>
          <div className="input-field bg-muted text-muted-foreground cursor-default">
            {shiftHours(form.startTime, form.endTime)}h per person
          </div>
        </div>
      </div>
      <div>
        <label className="form-label">Shift notes</label>
        <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} className="input-field w-full resize-none" placeholder="Optional notes…" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="submit" className="btn-primary flex-1">Save shift</button>
      </div>
    </form>
  );
}
