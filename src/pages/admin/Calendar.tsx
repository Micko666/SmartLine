/**
 * Calendar — Bookings & Staff Roster.
 *
 * Tab 1 — Bookings:
 *   Monthly calendar view, day-detail panel, pending queue.
 *   Toggle button reveals event packages panel inline.
 *
 * Tab 2 — Roster:
 *   Weekly shift grid + Work Log sub-view.
 *   Each shift holds named assignments: employee + role + optional split note.
 *
 * ⚙️ icon → Settings modal (booking rules, working hours, templates, link).
 */
import { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Check, X, Clock, Users,
  CalendarDays, Settings2, Package, AlertCircle, Edit2, Trash2,
  Phone, Mail, Link, UserPlus, Layers, History,
  LayoutGrid, Info, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type {
  CalendarEvent, CalendarEventType, EventPackage, WorkingDay,
  Employee, Shift, ShiftAssignment, ShiftTemplate,
  WeeklyShiftSlot, WeeklyDayTemplate,
} from '@/domain/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function today()          { return isoDate(new Date()); }

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function shiftHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = sh * 60 + sm;
  let end = eh * 60 + em;
  if (end <= start) end += 24 * 60;
  return Math.round((end - start) / 60 * 10) / 10;
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning/15 text-warning border-warning/30',
  approved:  'bg-success/15 text-success border-success/30',
  rejected:  'bg-destructive/15 text-destructive border-destructive/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
  completed: 'bg-primary/10 text-primary border-primary/20',
};

const TYPE_EMOJI: Record<CalendarEventType, string> = {
  reservation: '🪑', private_event: '🎉', closure: '🔒', takeaway: '🥡', delivery: '🚚',
};

const TYPE_LABEL: Record<CalendarEventType, string> = {
  reservation: 'Reservation', private_event: 'Private Event',
  closure: 'Closure / Blocked', takeaway: 'Takeaway', delivery: 'Delivery',
};

const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316',
  '#eab308','#22c55e','#14b8a6','#0ea5e9','#64748b',
];

// ─── Shared Modal ─────────────────────────────────────────────────────────────

function Modal({ title, subtitle, onClose, wide, children }: {
  title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 bg-foreground/30 backdrop-blur-sm overflow-y-auto">
      <div className={`bg-card rounded-2xl shadow-xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} mb-8`}>
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <h2 className="font-display font-bold text-lg leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground shrink-0 ml-3">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border capitalize ${STATUS_COLORS[status] ?? 'bg-muted'}`}>
      {status}
    </span>
  );
}

// ─── Event form ───────────────────────────────────────────────────────────────

function EventForm({ initialDate, packages, onSave, onClose }: {
  initialDate?: string;
  packages: EventPackage[];
  onSave: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    date: initialDate ?? today(), timeSlot: '18:00', endTime: '21:00',
    type: 'reservation' as CalendarEventType, customerName: '', customerPhone: '',
    customerEmail: '', guestCount: 2, packageId: '', notes: '',
    closureReason: '', status: 'approved' as CalendarEvent['status'],
  });
  const isClosure = form.type === 'closure';

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!isClosure && !form.customerName.trim()) { toast.error('Customer name required'); return; }
      const pkg = packages.find(p => p.id === form.packageId);
      onSave({
        date: form.date, timeSlot: form.timeSlot, endTime: form.endTime || undefined,
        type: form.type, status: form.status,
        customerName: isClosure ? '' : form.customerName,
        customerPhone: isClosure ? '' : form.customerPhone,
        customerEmail: isClosure ? '' : form.customerEmail,
        guestCount: isClosure ? 0 : form.guestCount,
        packageId: form.packageId || undefined, packageName: pkg?.name,
        notes: form.notes, closureReason: isClosure ? form.closureReason : undefined,
        createdBy: 'manager',
      });
    }} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Date</label>
          <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} className="input-field w-full" required />
        </div>
        <div>
          <label className="form-label">Type</label>
          <select value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value as CalendarEventType}))} className="input-field w-full">
            {(Object.entries(TYPE_LABEL) as [CalendarEventType, string][]).map(([v, label]) => (
              <option key={v} value={v}>{label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Start</label>
          <input type="time" value={form.timeSlot} onChange={e => setForm(f => ({...f, timeSlot: e.target.value}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">End</label>
          <input type="time" value={form.endTime} onChange={e => setForm(f => ({...f, endTime: e.target.value}))} className="input-field w-full" />
        </div>
      </div>
      {isClosure ? (
        <div>
          <label className="form-label">Reason</label>
          <input type="text" value={form.closureReason} onChange={e => setForm(f => ({...f, closureReason: e.target.value}))} placeholder="Holiday, Renovation…" className="input-field w-full" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Customer name *</label>
              <input type="text" value={form.customerName} onChange={e => setForm(f => ({...f, customerName: e.target.value}))} className="input-field w-full" required />
            </div>
            <div>
              <label className="form-label">Guests</label>
              <input type="number" min={1} max={500} value={form.guestCount} onChange={e => setForm(f => ({...f, guestCount: Number(e.target.value)}))} className="input-field w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Phone</label>
              <input type="tel" value={form.customerPhone} onChange={e => setForm(f => ({...f, customerPhone: e.target.value}))} className="input-field w-full" />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" value={form.customerEmail} onChange={e => setForm(f => ({...f, customerEmail: e.target.value}))} className="input-field w-full" />
            </div>
          </div>
          {packages.filter(p => p.active).length > 0 && (
            <div>
              <label className="form-label">Package (optional)</label>
              <select value={form.packageId} onChange={e => setForm(f => ({...f, packageId: e.target.value}))} className="input-field w-full">
                <option value="">No package</option>
                {packages.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
            </div>
          )}
        </>
      )}
      <div>
        <label className="form-label">Notes</label>
        <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} className="input-field w-full resize-none" placeholder="Special requests…" />
      </div>
      <div>
        <label className="form-label">Status</label>
        <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value as CalendarEvent['status']}))} className="input-field w-full">
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="submit" className="btn-primary flex-1">Save event</button>
      </div>
    </form>
  );
}

// ─── Package form ─────────────────────────────────────────────────────────────

function PackageForm({ initial, sym, onSave, onClose }: {
  initial?: Partial<EventPackage>;
  sym: string;
  onSave: (data: Omit<EventPackage, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', emoji: initial?.emoji ?? '🎉',
    description: initial?.description ?? '',
    minGuests: initial?.minGuests ?? 10, maxGuests: initial?.maxGuests ?? 100,
    fixedPrice: initial?.fixedPrice as number | undefined,
    pricePerPerson: initial?.pricePerPerson as number | undefined,
    duration: initial?.duration ?? 3, details: initial?.details ?? '',
    active: initial?.active ?? true,
  });

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!form.name.trim()) { toast.error('Name required'); return; }
      onSave(form);
    }} className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="form-label">Icon</label>
          <input type="text" value={form.emoji} maxLength={2} onChange={e => setForm(f => ({...f, emoji: e.target.value}))} className="input-field w-full text-center text-2xl" />
        </div>
        <div className="col-span-3">
          <label className="form-label">Name *</label>
          <input type="text" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input-field w-full" required />
        </div>
      </div>
      <div>
        <label className="form-label">Description</label>
        <input type="text" value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} className="input-field w-full" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="form-label">Min guests</label>
          <input type="number" min={1} value={form.minGuests} onChange={e => setForm(f => ({...f, minGuests: Number(e.target.value)}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">Max guests</label>
          <input type="number" min={1} value={form.maxGuests} onChange={e => setForm(f => ({...f, maxGuests: Number(e.target.value)}))} className="input-field w-full" />
        </div>
        <div>
          <label className="form-label">Duration (hrs)</label>
          <input type="number" min={0.5} step={0.5} value={form.duration} onChange={e => setForm(f => ({...f, duration: Number(e.target.value)}))} className="input-field w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Fixed price ({sym})</label>
          <input type="number" min={0} step={0.01} value={form.fixedPrice ?? ''} onChange={e => setForm(f => ({...f, fixedPrice: e.target.value ? Number(e.target.value) : undefined}))} className="input-field w-full" placeholder="Leave blank if per-person" />
        </div>
        <div>
          <label className="form-label">Per person ({sym})</label>
          <input type="number" min={0} step={0.01} value={form.pricePerPerson ?? ''} onChange={e => setForm(f => ({...f, pricePerPerson: e.target.value ? Number(e.target.value) : undefined}))} className="input-field w-full" placeholder="Leave blank if fixed" />
        </div>
      </div>
      <div>
        <label className="form-label">What's included</label>
        <textarea value={form.details} onChange={e => setForm(f => ({...f, details: e.target.value}))} rows={3} className="input-field w-full resize-none" placeholder="Dedicated area, custom cake, 3-course meal…" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({...f, active: e.target.checked}))} className="rounded" />
        <span className="text-sm font-medium">Active (visible to customers)</span>
      </label>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="submit" className="btn-primary flex-1">Save package</button>
      </div>
    </form>
  );
}

// ─── Employee form ─────────────────────────────────────────────────────────────

function EmployeeForm({ initial, onSave, onClose }: {
  initial?: Employee;
  onSave: (data: Omit<Employee, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', role: initial?.role ?? '',
    phone: initial?.phone ?? '', email: initial?.email ?? '',
    color: initial?.color ?? PRESET_COLORS[0], active: initial?.active ?? true,
  });

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!form.name.trim()) return;
      onSave({ name: form.name.trim(), role: form.role.trim(), phone: form.phone.trim() || undefined, email: form.email.trim() || undefined, color: form.color, active: form.active });
    }} className="space-y-4">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white shadow-sm" style={{ backgroundColor: form.color }}>
          {form.name ? initials(form.name) : '?'}
        </div>
      </div>
      <div>
        <label className="form-label">Name *</label>
        <input type="text" required value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input-field w-full" placeholder="Full name" />
      </div>
      <div>
        <label className="form-label">Default role / position</label>
        <input type="text" value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} className="input-field w-full" placeholder="Chef, Server, Bartender…" />
        <p className="text-[10px] text-muted-foreground mt-1">General label — set specific roles per shift.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label"><Phone className="w-3 h-3 inline mr-0.5" /> Phone</label>
          <input type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className="input-field w-full" placeholder="+1 234…" />
        </div>
        <div>
          <label className="form-label"><Mail className="w-3 h-3 inline mr-0.5" /> Email</label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} className="input-field w-full" placeholder="staff@…" />
        </div>
      </div>
      <div>
        <label className="form-label">Color</label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setForm(f => ({...f, color: c}))}
              className={`w-8 h-8 rounded-xl border-2 transition-all ${form.color === c ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({...f, active: e.target.checked}))} className="w-4 h-4 rounded" />
        <span className="text-sm font-medium">Active (show in roster)</span>
      </label>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="submit" className="btn-primary flex-1">Save employee</button>
      </div>
    </form>
  );
}

// ─── Shift form ───────────────────────────────────────────────────────────────

function ShiftForm({ initial, initialDate, employees, stations, templates, onSave, onClose }: {
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

// ─── Shift template form ───────────────────────────────────────────────────────

function ShiftTemplateForm({ initial, onSave, onClose }: {
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

// ─── Week Template Editor ─────────────────────────────────────────────────────

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// JS dayOfWeek: 0=Sun…6=Sat. Our display order is Mon(1)…Sun(0).
const DISPLAY_DOW: Array<0|1|2|3|4|5|6> = [1,2,3,4,5,6,0];

function WeekTemplateEditor({ template, onSave, onClose }: {
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

// ─── Shift assign panel (replaces modal click for quick staff assignment) ──────

function ShiftAssignPanel({ shift, employees, stations, onClose, onEditFull, onDelete, onUpdateAssignments }: {
  shift: Shift;
  employees: Employee[];
  stations: { id: string; name: string; color: string }[];
  onClose: () => void;
  onEditFull: () => void;
  onDelete: () => void;
  onUpdateAssignments: (a: ShiftAssignment[]) => void;
}) {
  const station      = stations.find(s => s.id === shift.stationId);
  const activeEmps   = employees.filter(e => e.active);
  const assignedIds  = new Set(shift.assignments.map(a => a.employeeId));

  function toggle(empId: string) {
    if (assignedIds.has(empId)) {
      onUpdateAssignments(shift.assignments.filter(a => a.employeeId !== empId));
    } else {
      const emp  = employees.find(e => e.id === empId);
      onUpdateAssignments([...shift.assignments, { employeeId: empId, role: emp?.role || 'Staff' }]);
    }
  }

  function changeRole(empId: string, role: string) {
    onUpdateAssignments(shift.assignments.map(a => a.employeeId === empId ? { ...a, role } : a));
  }

  return (
    <div className="glass-card border border-primary/20 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-3 h-10 rounded-full shrink-0" style={{ backgroundColor: shift.color }} />
          <div className="min-w-0">
            <p className="font-display font-bold text-base leading-tight">{shift.name}</p>
            <p className="text-sm text-muted-foreground font-mono">{shift.startTime}–{shift.endTime} · {shiftHours(shift.startTime, shift.endTime)}h</p>
            {station && (
              <span className="inline-block text-[10px] px-2 py-0.5 rounded-full font-medium text-white mt-1" style={{ backgroundColor: station.color }}>
                {station.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onEditFull} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground" title="Edit full details">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive" title="Delete shift">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Currently assigned */}
      <div>
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Staff assigned ({shift.assignments.length}{shift.minStaff > 0 ? `/${shift.minStaff} min` : ''})
        </p>
        {shift.assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Nobody assigned yet — tap a team member below to add them.</p>
        ) : (
          <div className="space-y-1.5">
            {shift.assignments.map((a) => {
              const emp = employees.find(e => e.id === a.employeeId);
              if (!emp) return null;
              return (
                <div key={a.employeeId} className="flex items-center gap-2.5 p-2 rounded-xl bg-muted/40">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: emp.color }}>
                    {initials(emp.name)}
                  </div>
                  <span className="text-sm font-medium flex-1 min-w-0 truncate">{emp.name}</span>
                  <input
                    type="text" value={a.role}
                    onChange={e => changeRole(a.employeeId, e.target.value)}
                    className="input-field py-0.5 text-xs w-28 shrink-0"
                    placeholder="Role…"
                  />
                  <button onClick={() => toggle(a.employeeId)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add from team */}
      {activeEmps.some(e => !assignedIds.has(e.id)) && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Add from team</p>
          <div className="flex flex-wrap gap-1.5">
            {activeEmps.filter(e => !assignedIds.has(e.id)).map(emp => (
              <button key={emp.id} onClick={() => toggle(emp.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-border hover:border-current bg-card hover:shadow-sm transition-all text-xs font-medium"
                style={{ color: emp.color }}>
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: emp.color }}>
                  {initials(emp.name)}
                </span>
                {emp.name.split(' ')[0]}
                {emp.role && <span className="text-muted-foreground font-normal">· {emp.role}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {shift.notes && (
        <p className="text-xs text-muted-foreground border-t border-border pt-3">{shift.notes}</p>
      )}
    </div>
  );
}

// ─── Work Log ─────────────────────────────────────────────────────────────────

function WorkLog({ shifts, employees }: { shifts: Shift[]; employees: Employee[] }) {
  const [filterEmpId, setFilterEmpId] = useState('');
  const [filterDays, setFilterDays]   = useState(30);

  const empMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const cutoff = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - filterDays); return isoDate(d);
  }, [filterDays]);

  const rows = useMemo(() => {
    const result: { shift: Shift; assignment: ShiftAssignment; emp: Employee; hours: number }[] = [];
    for (const shift of shifts) {
      if (shift.date > today() || shift.date < cutoff) continue;
      for (const a of shift.assignments) {
        if (filterEmpId && a.employeeId !== filterEmpId) continue;
        const emp = empMap.get(a.employeeId);
        if (!emp) continue;
        result.push({ shift, assignment: a, emp, hours: shiftHours(shift.startTime, shift.endTime) });
      }
    }
    return result.sort((a, b) => b.shift.date.localeCompare(a.shift.date));
  }, [shifts, empMap, filterEmpId, cutoff]);

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.emp.id, (map.get(r.emp.id) ?? 0) + r.hours);
    return Array.from(map.entries())
      .map(([id, hours]) => ({ emp: empMap.get(id)!, hours }))
      .filter(t => t.emp).sort((a, b) => b.hours - a.hours);
  }, [rows, empMap]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterEmpId} onChange={e => setFilterEmpId(e.target.value)} className="input-field text-sm py-1.5">
          <option value="">All employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={filterDays} onChange={e => setFilterDays(Number(e.target.value))} className="input-field text-sm py-1.5">
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{rows.length} records</span>
      </div>
      {totals.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Hours summary</p>
          <div className="flex flex-wrap gap-3">
            {totals.map(t => (
              <div key={t.emp.id} className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: t.emp.color }}>
                  {initials(t.emp.name)}
                </div>
                <div>
                  <p className="text-xs font-semibold leading-none">{t.emp.name}</p>
                  <p className="text-[11px] text-muted-foreground">{t.hours}h</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="glass-card p-10 text-center">
          <History className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground font-semibold">No work log entries</p>
          <p className="text-sm text-muted-foreground mt-1">Past shifts with assigned staff will appear here.</p>
        </div>
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Date</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Shift</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Employee</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Role</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground hidden sm:table-cell">Note</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, idx) => (
                <tr key={idx} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(r.shift.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.shift.color }} />
                      <div>
                        <p className="text-xs font-medium">{r.shift.name}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{r.shift.startTime}–{r.shift.endTime}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0" style={{ backgroundColor: r.emp.color }}>
                        {initials(r.emp.name)}
                      </div>
                      <span className="text-xs font-medium">{r.emp.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium">{r.assignment.role}</span>
                  </td>
                  <td className="px-4 py-2.5 hidden sm:table-cell">
                    {r.assignment.roleNote && <span className="text-[11px] text-muted-foreground italic">{r.assignment.roleNote}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="text-xs font-semibold text-foreground">{r.hours}h</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

type Tab = 'bookings' | 'roster';
type RosterView = 'grid' | 'log';

export default function CalendarPage() {
  const {
    calendarEvents, eventPackages, calendarSettings, settings, user,
    employees, shifts,
    addCalendarEvent, deleteCalendarEvent,
    approveCalendarEvent, rejectCalendarEvent,
    addEventPackage, updateEventPackage, deleteEventPackage,
    updateCalendarSettings,
    addEmployee, updateEmployee, deleteEmployee,
    addShift, updateShift, deleteShift,
    applyWeekTemplate, updateWeekTemplate,
  } = useStore(useShallow(s => ({
    calendarEvents: s.calendarEvents, eventPackages: s.eventPackages,
    calendarSettings: s.calendarSettings, settings: s.settings, user: s.user,
    employees: s.employees, shifts: s.shifts,
    addCalendarEvent: s.addCalendarEvent, deleteCalendarEvent: s.deleteCalendarEvent,
    approveCalendarEvent: s.approveCalendarEvent, rejectCalendarEvent: s.rejectCalendarEvent,
    addEventPackage: s.addEventPackage, updateEventPackage: s.updateEventPackage, deleteEventPackage: s.deleteEventPackage,
    updateCalendarSettings: s.updateCalendarSettings,
    addEmployee: s.addEmployee, updateEmployee: s.updateEmployee, deleteEmployee: s.deleteEmployee,
    addShift: s.addShift, updateShift: s.updateShift, deleteShift: s.deleteShift,
    applyWeekTemplate: s.applyWeekTemplate, updateWeekTemplate: s.updateWeekTemplate,
  })));

  const sym            = settings.currencySymbol;
  const shiftTemplates = calendarSettings.shiftTemplates ?? [];
  const stations       = settings.stations ?? [];

  // ── UI state ──────────────────────────────────────────────────────────────────

  const [tab, setTab]                   = useState<Tab>('bookings');
  const [rosterView, setRosterView]     = useState<RosterView>('grid');
  const [currentDate, setCurrentDate]   = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(today());
  const [showPackagesPanel, setShowPackagesPanel] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAllPending, setShowAllPending]       = useState(false);

  // Modals
  const [showEventForm, setShowEventForm]           = useState(false);
  const [showPackageForm, setShowPackageForm]       = useState(false);
  const [editingPackage, setEditingPackage]         = useState<EventPackage | null>(null);
  const [rejectId, setRejectId]                     = useState<string | null>(null);
  const [rejectReason, setRejectReason]             = useState('');
  const [rosterWeekOffset, setRosterWeekOffset]     = useState(0);
  const [showEmployeeForm, setShowEmployeeForm]     = useState(false);
  const [editingEmployee, setEditingEmployee]       = useState<Employee | null>(null);
  const [showShiftForm, setShowShiftForm]           = useState(false);
  const [editingShift, setEditingShift]             = useState<Shift | null>(null);
  const [shiftInitDate, setShiftInitDate]           = useState<string | undefined>();
  const [showTemplateForm, setShowTemplateForm]     = useState(false);
  const [editingTemplate, setEditingTemplate]       = useState<ShiftTemplate | null>(null);
  const [activeShiftId, setActiveShiftId]           = useState<string | null>(null);
  const [showWeekTemplateEditor, setShowWeekTemplateEditor] = useState(false);
  const [addingException, setAddingException]       = useState(false);
  const [exceptionForm, setExceptionForm]           = useState({ date: today(), isClosed: true, note: '', openTime: '09:00', closeTime: '22:00' });

  // ── Calendar helpers ───────────────────────────────────────────────────────

  const year        = currentDate.getFullYear();
  const month       = currentDate.getMonth();
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    calendarEvents.forEach(e => { if (!map[e.date]) map[e.date] = []; map[e.date].push(e); });
    return map;
  }, [calendarEvents]);

  const pendingEvents = useMemo(
    () => calendarEvents.filter(e => e.status === 'pending').sort((a, b) => a.date.localeCompare(b.date)),
    [calendarEvents],
  );

  function isWorkingDay(dateStr: string) {
    const d = new Date(dateStr);
    const dow = d.getDay() as WorkingDay['dayOfWeek'];
    const exc = calendarSettings.workingExceptions.find(ex => ex.date === dateStr);
    if (exc) return !exc.isClosed;
    return calendarSettings.workingDays.find(wd => wd.dayOfWeek === dow)?.isOpen ?? false;
  }

  // ── Roster helpers ─────────────────────────────────────────────────────────

  const rosterWeekDays = useMemo(() => {
    const base = new Date();
    const day  = base.getDay();
    base.setDate(base.getDate() + (day === 0 ? -6 : 1 - day) + rosterWeekOffset * 7);
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() + i); return d.toISOString().slice(0, 10);
    });
  }, [rosterWeekOffset]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const sh of shifts) { if (!map.has(sh.date)) map.set(sh.date, []); map.get(sh.date)!.push(sh); }
    return map;
  }, [shifts]);

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const rosterLink  = `${window.location.origin}/roster/${settings.restaurantToken}`;
  const weekTemplate = calendarSettings.weekTemplate ?? [];
  const hasWeekTemplate = weekTemplate.some(d => d.slots.length > 0);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleApprove(id: string) { approveCalendarEvent(id, user?.name ?? 'Manager'); toast.success('Approved'); }
  function handleReject() {
    if (!rejectId) return;
    rejectCalendarEvent(rejectId, rejectReason);
    setRejectId(null); setRejectReason('');
    toast.success('Rejected');
  }

  function updateWorkingDay(dow: number, updates: Partial<WorkingDay>) {
    updateCalendarSettings({ workingDays: calendarSettings.workingDays.map(d => d.dayOfWeek === dow ? { ...d, ...updates } : d) });
  }

  function saveException() {
    if (!exceptionForm.date) return;
    if (calendarSettings.workingExceptions.find(e => e.date === exceptionForm.date)) {
      toast.error('An exception for this date already exists'); return;
    }
    updateCalendarSettings({
      workingExceptions: [...calendarSettings.workingExceptions, {
        id: crypto.randomUUID(),
        date: exceptionForm.date,
        isClosed: exceptionForm.isClosed,
        note: exceptionForm.note.trim(),
        openTime: exceptionForm.openTime,
        closeTime: exceptionForm.closeTime,
      }],
    });
    setAddingException(false);
    setExceptionForm({ date: today(), isClosed: true, note: '', openTime: '09:00', closeTime: '22:00' });
    toast.success('Exception added');
  }

  function quickUpdateAssignments(shiftId: string, assignments: ShiftAssignment[]) {
    const shift = shifts.find(s => s.id === shiftId);
    if (!shift) return;
    updateShift(shiftId, { ...shift, assignments });
  }

  function saveTemplate(data: Omit<ShiftTemplate, 'id'>) {
    const next = editingTemplate
      ? shiftTemplates.map(t => t.id === editingTemplate.id ? { ...data, id: t.id } : t)
      : [...shiftTemplates, { ...data, id: crypto.randomUUID() }];
    updateCalendarSettings({ shiftTemplates: next });
    setShowTemplateForm(false); setEditingTemplate(null);
    toast.success(editingTemplate ? 'Template updated' : 'Template created');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const selectedDayEvents = eventsByDate[selectedDate] ?? [];

  return (
    <DashboardLayout>
      <style>{`.form-label { display: block; font-size: 0.75rem; font-weight: 500; color: hsl(var(--muted-foreground)); margin-bottom: 0.25rem; }`}</style>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Calendar</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Bookings & staff roster</p>
          </div>
          <div className="flex items-center gap-2">
            {pendingEvents.length > 0 && (
              <button onClick={() => { setTab('bookings'); setShowAllPending(true); }}
                className="flex items-center gap-1.5 text-xs font-bold text-warning px-3 py-1.5 bg-warning/15 rounded-lg border border-warning/40 hover:bg-warning/25 transition-colors animate-pulse">
                <AlertCircle className="w-3.5 h-3.5" /> {pendingEvents.length} awaiting approval
              </button>
            )}
            {tab === 'bookings' && (
              <button onClick={() => setShowEventForm(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> New event
              </button>
            )}
            {tab === 'roster' && rosterView === 'grid' && (
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(rosterLink); toast.success('Link copied!'); }}
                  className="btn-ghost flex items-center gap-1.5 text-sm">
                  <Link className="w-3.5 h-3.5" /> Staff link
                </button>
                <button onClick={() => { setEditingEmployee(null); setShowEmployeeForm(true); }}
                  className="btn-primary flex items-center gap-1.5">
                  <UserPlus className="w-4 h-4" /> Add employee
                </button>
              </div>
            )}
            {/* Settings */}
            <button onClick={() => setShowSettingsModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-muted transition-colors text-sm font-medium text-muted-foreground hover:text-foreground"
              title="Hours, rules, templates">
              <Settings2 className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border">
          {(['bookings', 'roster'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px whitespace-nowrap flex items-center gap-1.5 ${tab === t ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              {t === 'bookings' && <CalendarDays className="w-3.5 h-3.5" />}
              {t === 'roster'   && <Users className="w-3.5 h-3.5" />}
              {t}
              {t === 'bookings' && pendingEvents.length > 0 && (
                <span className="text-[10px] bg-warning text-white px-1.5 py-0.5 rounded-full font-bold">{pendingEvents.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── BOOKINGS TAB ── */}
        {tab === 'bookings' && (
          <div className="space-y-5">
            {/* Getting-started hint: shown only when the calendar is totally empty */}
            {calendarEvents.length === 0 && eventPackages.length === 0 && (
              <div className="glass-card p-4 border border-primary/20 bg-primary/5">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                    <Info className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm leading-tight">Getting started with Calendar</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Click <strong>New event</strong> above to add a reservation, or expand <strong>Event Packages</strong> below to create bookable presets (birthdays, private dinners, etc.).
                      Use <strong>Settings</strong> to set your working hours and booking rules.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-5">
              {/* Calendar */}
              <div className="lg:col-span-2 glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} className="p-2 rounded-xl hover:bg-muted transition-colors"><ChevronLeft className="w-4 h-4" /></button>
                  <h2 className="font-display font-bold text-lg">{MONTH_NAMES[month]} {year}</h2>
                  <button onClick={() => setCurrentDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} className="p-2 rounded-xl hover:bg-muted transition-colors"><ChevronRight className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-7 mb-1">
                  {DAY_NAMES.map(d => <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">{d}</div>)}
                </div>
                <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
                  {Array.from({length: firstDay}).map((_, i) => <div key={`b${i}`} className="bg-card h-14 sm:h-16" />)}
                  {Array.from({length: daysInMonth}, (_, i) => i+1).map(day => {
                    const ds  = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                    const evs = eventsByDate[ds] ?? [];
                    const isToday = ds === today();
                    return (
                      <button key={day} onClick={() => setSelectedDate(ds)}
                        className={`bg-card h-14 sm:h-16 p-1.5 flex flex-col items-start transition-colors hover:bg-muted/50 ${ds === selectedDate ? 'ring-2 ring-inset ring-primary' : ''} ${!isWorkingDay(ds) ? 'opacity-40' : ''}`}>
                        <span className={`text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-primary text-primary-foreground' : ''}`}>{day}</span>
                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                          {evs.some(e => e.status==='pending')  && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
                          {evs.some(e => e.status==='approved') && <span className="w-1.5 h-1.5 rounded-full bg-success" />}
                          {evs.some(e => e.type==='closure')    && <span className="w-1.5 h-1.5 rounded-full bg-destructive" />}
                        </div>
                        {evs.length > 0 && <span className="text-[9px] text-muted-foreground mt-auto">{evs.length}ev</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-4 mt-3 text-[11px] text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Approved</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Pending</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" /> Blocked</span>
                </div>
              </div>

              {/* Day detail + pending */}
              <div className="space-y-4">
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display font-semibold text-sm">
                      {new Date(selectedDate+'T12:00:00').toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}
                    </h3>
                    <button onClick={() => setShowEventForm(true)} className="text-primary text-xs font-semibold flex items-center gap-0.5 hover:underline">
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </div>
                  {selectedDayEvents.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No events.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedDayEvents.sort((a,b) => a.timeSlot.localeCompare(b.timeSlot)).map(ev => (
                        <div key={ev.id} className="p-3 rounded-xl border border-border bg-muted/20">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                <span className="text-sm" title={TYPE_LABEL[ev.type]}>{TYPE_EMOJI[ev.type]}</span>
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{TYPE_LABEL[ev.type]}</span>
                                <span className="text-xs font-semibold truncate">· {ev.type==='closure' ? ev.closureReason||'Closed' : ev.customerName}</span>
                                <StatusBadge status={ev.status} />
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span><Clock className="w-3 h-3 inline" /> {ev.timeSlot}{ev.endTime ? `–${ev.endTime}` : ''}</span>
                                {ev.guestCount > 0 && <span><Users className="w-3 h-3 inline" /> {ev.guestCount}</span>}
                              </div>
                              {ev.packageName && <span className="text-[10px] text-primary font-medium">{ev.packageName}</span>}
                              {ev.notes && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{ev.notes}</p>}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {ev.status === 'pending' && (
                                <>
                                  <button onClick={() => handleApprove(ev.id)} className="p-1.5 rounded-lg bg-success/10 text-success hover:bg-success/20"><Check className="w-3.5 h-3.5" /></button>
                                  <button onClick={() => setRejectId(ev.id)} className="p-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20"><X className="w-3.5 h-3.5" /></button>
                                </>
                              )}
                              <button onClick={() => { deleteCalendarEvent(ev.id); toast.success('Event deleted'); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {pendingEvents.length > 0 && (
                  <div className="glass-card p-4 border border-warning/30 bg-warning/5 ring-1 ring-warning/20">
                    <h3 className="font-display font-bold text-sm mb-1 flex items-center gap-1.5 text-warning">
                      <AlertCircle className="w-4 h-4" /> {pendingEvents.length} booking{pendingEvents.length === 1 ? '' : 's'} waiting
                    </h3>
                    <p className="text-[11px] text-muted-foreground mb-3">Approve or reject to notify the customer.</p>
                    <div className="space-y-2">
                      {(showAllPending ? pendingEvents : pendingEvents.slice(0,5)).map(ev => (
                        <div key={ev.id} className="p-2.5 rounded-xl bg-card border border-warning/30">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{ev.customerName}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {new Date(ev.date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})} · {ev.timeSlot} · <span title={TYPE_LABEL[ev.type]}>{TYPE_EMOJI[ev.type]} {TYPE_LABEL[ev.type]}</span>
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => handleApprove(ev.id)} title="Approve" className="p-1.5 rounded-lg bg-success/10 text-success hover:bg-success/20"><Check className="w-3.5 h-3.5" /></button>
                              <button onClick={() => setRejectId(ev.id)} title="Reject" className="p-1.5 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20"><X className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {pendingEvents.length > 5 && (
                        <button
                          onClick={() => setShowAllPending(v => !v)}
                          className="w-full text-[11px] text-primary hover:underline font-semibold py-1"
                        >
                          {showAllPending ? 'Show less' : `Show all ${pendingEvents.length}`}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ── Event packages panel (toggleable) ── */}
            <div className="glass-card overflow-hidden">
              <button
                onClick={() => setShowPackagesPanel(v => !v)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <span className="font-semibold text-sm">Event Packages</span>
                    {eventPackages.length === 0 && (
                      <p className="text-xs text-muted-foreground leading-none mt-0.5">Preset options for private bookings</p>
                    )}
                    {eventPackages.length > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">({eventPackages.filter(p => p.active).length} active)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); setEditingPackage(null); setShowPackageForm(true); }}
                    className="flex items-center gap-1 text-xs text-primary font-medium hover:underline">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                  {showPackagesPanel ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>

              {showPackagesPanel && (
                <div className="border-t border-border p-5">
                  {eventPackages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No packages yet. Create presets customers can choose when booking a private event.</p>
                  ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {eventPackages.map(pkg => (
                        <div key={pkg.id} className={`p-4 rounded-xl border border-border ${!pkg.active ? 'opacity-50' : ''}`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-2xl">{pkg.emoji}</span>
                              <div>
                                <p className="font-semibold text-sm">{pkg.name}</p>
                                {!pkg.active && <span className="text-[10px] text-muted-foreground">inactive</span>}
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => { setEditingPackage(pkg); setShowPackageForm(true); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => { deleteEventPackage(pkg.id); toast.success('Package deleted'); }} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                          {pkg.description && <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{pkg.description}</p>}
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            <span><Users className="w-3 h-3 inline" /> {pkg.minGuests}–{pkg.maxGuests}</span>
                            <span><Clock className="w-3 h-3 inline" /> {pkg.duration}h</span>
                            {pkg.fixedPrice     != null && <span className="font-semibold text-foreground">{sym}{pkg.fixedPrice}</span>}
                            {pkg.pricePerPerson != null && <span className="font-semibold text-foreground">{sym}{pkg.pricePerPerson}/person</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── ROSTER TAB ── */}
        {tab === 'roster' && (
          <div className="space-y-4">
            {/* Sub-view toggle */}
            <div className="flex items-center gap-1 bg-muted/50 p-1 rounded-xl w-fit">
              {([['grid','Schedule',LayoutGrid],['log','Work Log',History]] as const).map(([v, label, Icon]) => (
                <button key={v} onClick={() => setRosterView(v as RosterView)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${rosterView === v ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {rosterView === 'grid' && (
              <>
                {/* Default week banner */}
                <div className="glass-card overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <Layers className="w-4 h-4 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight">Default staff week</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {hasWeekTemplate
                            ? weekTemplate.flatMap(d => d.slots).length + ' shift slots defined — apply to any week in one click'
                            : 'Your recurring shift pattern — define once, stamp onto any week'
                          }
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasWeekTemplate && (
                        <button onClick={() => {
                          applyWeekTemplate(rosterWeekDays[0]);
                        }} className="btn-primary text-sm flex items-center gap-1.5 py-1.5">
                          <LayoutGrid className="w-3.5 h-3.5" /> Apply to this week
                        </button>
                      )}
                      <button onClick={() => setShowWeekTemplateEditor(v => !v)}
                        className={`btn-ghost text-sm flex items-center gap-1.5 py-1.5 ${showWeekTemplateEditor ? 'text-primary' : ''}`}>
                        <Edit2 className="w-3.5 h-3.5" />
                        {hasWeekTemplate ? 'Edit' : 'Set up'}
                      </button>
                    </div>
                  </div>

                  {showWeekTemplateEditor && (
                    <div className="border-t border-border p-4">
                      <WeekTemplateEditor
                        template={weekTemplate}
                        onSave={tpl => { updateWeekTemplate(tpl); toast.success('Default week saved'); }}
                        onClose={() => setShowWeekTemplateEditor(false)}
                      />
                    </div>
                  )}
                </div>

                {/* Team bar */}
                {employees.length > 0 ? (
                  <div className="glass-card p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-muted-foreground shrink-0">Team:</span>
                      {employees.filter(e => e.active).map(emp => (
                        <button key={emp.id}
                          onClick={() => { setEditingEmployee(emp); setShowEmployeeForm(true); }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border hover:border-current transition-colors text-xs font-medium"
                          style={{ color: emp.color }}>
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white" style={{ backgroundColor: emp.color }}>
                            {initials(emp.name)}
                          </span>
                          {emp.name}
                          {emp.role && <span className="text-muted-foreground font-normal">· {emp.role}</span>}
                        </button>
                      ))}
                      {employees.filter(e => !e.active).length > 0 && (
                        <span className="text-xs text-muted-foreground/50">{employees.filter(e => !e.active).length} inactive</span>
                      )}
                      <button onClick={() => { setEditingEmployee(null); setShowEmployeeForm(true); }}
                        className="ml-auto text-xs text-primary hover:underline flex items-center gap-0.5">
                        <UserPlus className="w-3 h-3" /> Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="glass-card p-8 text-center">
                    <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="font-semibold text-muted-foreground">No employees yet</p>
                    <p className="text-sm text-muted-foreground mt-1">Add your team members first, then assign them to shifts.</p>
                    <button onClick={() => { setEditingEmployee(null); setShowEmployeeForm(true); }} className="btn-primary mt-4">
                      <UserPlus className="w-4 h-4 inline mr-1.5" />Add first employee
                    </button>
                  </div>
                )}

                {/* Week grid */}
                <div className="glass-card p-4">
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={() => { setRosterWeekOffset(w => w-1); setActiveShiftId(null); }} className="p-2 rounded-xl hover:bg-muted"><ChevronLeft className="w-4 h-4" /></button>
                    <div className="text-center">
                      <p className="font-semibold text-sm">
                        {new Date(rosterWeekDays[0]+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                        {' – '}
                        {new Date(rosterWeekDays[6]+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}
                      </p>
                      {rosterWeekOffset !== 0 && <button onClick={() => { setRosterWeekOffset(0); setActiveShiftId(null); }} className="text-xs text-primary hover:underline">This week</button>}
                    </div>
                    <button onClick={() => { setRosterWeekOffset(w => w+1); setActiveShiftId(null); }} className="p-2 rounded-xl hover:bg-muted"><ChevronRight className="w-4 h-4" /></button>
                  </div>
                  <div className="grid grid-cols-7 gap-2">
                    {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label, i) => {
                      const dateStr   = rosterWeekDays[i];
                      const dayShifts = shiftsByDate.get(dateStr) ?? [];
                      const isToday   = dateStr === today();
                      const isPast    = dateStr < today();
                      return (
                        <div key={dateStr} className={`flex flex-col gap-1.5 ${isPast && !isToday ? 'opacity-60' : ''}`}>
                          <div className={`text-center py-1.5 rounded-xl ${isToday ? 'bg-primary/10 ring-1 ring-primary/30' : ''}`}>
                            <p className={`text-[10px] uppercase tracking-wide font-semibold ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>{label}</p>
                            <p className={`text-sm font-bold leading-none mt-0.5 ${isToday ? 'text-primary' : 'text-foreground'}`}>{new Date(dateStr+'T12:00:00').getDate()}</p>
                          </div>
                          {dayShifts.map(shift => {
                            const understaffed = shift.assignments.length < shift.minStaff;
                            const station      = stations.find(s => s.id === shift.stationId);
                            const isActive     = activeShiftId === shift.id;
                            return (
                              <div key={shift.id}
                                className={`rounded-xl border overflow-hidden text-xs transition-all cursor-pointer relative ${isActive ? 'ring-2 ring-primary shadow-md' : 'hover:shadow-sm'} ${understaffed ? 'border-warning ring-1 ring-warning/40 bg-warning/5' : 'border-border bg-card'}`}
                                onClick={() => setActiveShiftId(isActive ? null : shift.id)}>
                                {understaffed && (
                                  <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-warning flex items-center justify-center shadow-sm" title={`Understaffed: need ${shift.minStaff - shift.assignments.length} more`}>
                                    <AlertCircle className="w-3 h-3 text-white" />
                                  </div>
                                )}
                                <div className="h-1.5" style={{ backgroundColor: shift.color }} />
                                <div className="p-2">
                                  <p className="font-semibold text-[11px] truncate">{shift.name}</p>
                                  <p className="font-mono text-[10px] text-muted-foreground">{shift.startTime}–{shift.endTime}</p>
                                  {station && (
                                    <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium text-white mt-0.5" style={{ backgroundColor: station.color }}>
                                      {station.name}
                                    </span>
                                  )}
                                  {shift.assignments.length === 0 ? (
                                    <p className="text-[10px] text-muted-foreground/60 italic mt-1.5">No staff</p>
                                  ) : (
                                    <div className="flex mt-1.5 -space-x-1">
                                      {shift.assignments.slice(0,4).map((a) => {
                                        const emp = employeeMap.get(a.employeeId);
                                        if (!emp) return null;
                                        return (
                                          <span key={a.employeeId} title={`${emp.name} · ${a.role}`}
                                            className="w-5 h-5 rounded-full border-2 border-card flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                                            style={{ backgroundColor: emp.color }}>
                                            {initials(emp.name)}
                                          </span>
                                        );
                                      })}
                                      {shift.assignments.length > 4 && (
                                        <span className="w-5 h-5 rounded-full border-2 border-card bg-muted flex items-center justify-center text-[7px] font-bold text-muted-foreground">
                                          +{shift.assignments.length - 4}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {understaffed && <p className="text-[10px] text-warning font-semibold mt-1">Need {shift.minStaff - shift.assignments.length} more</p>}
                                </div>
                              </div>
                            );
                          })}
                          <button onClick={() => { setEditingShift(null); setShiftInitDate(dateStr); setShowShiftForm(true); }}
                            className="text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary/50 rounded-xl py-2 transition-colors text-center hover:bg-primary/5">
                            + shift
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Assignment panel — shows when a shift is selected */}
                {activeShiftId && (() => {
                  const activeShift = shifts.find(s => s.id === activeShiftId);
                  if (!activeShift) return null;
                  return (
                    <ShiftAssignPanel
                      shift={activeShift}
                      employees={employees}
                      stations={stations}
                      onClose={() => setActiveShiftId(null)}
                      onEditFull={() => {
                        setEditingShift(activeShift);
                        setShiftInitDate(undefined);
                        setShowShiftForm(true);
                        setActiveShiftId(null);
                      }}
                      onDelete={() => {
                        deleteShift(activeShiftId);
                        setActiveShiftId(null);
                        toast.success('Shift deleted');
                      }}
                      onUpdateAssignments={assignments =>
                        quickUpdateAssignments(activeShiftId, assignments)
                      }
                    />
                  );
                })()}
              </>
            )}

            {rosterView === 'log' && <WorkLog shifts={shifts} employees={employees} />}
          </div>
        )}
      </div>

      {/* ── Settings Modal ── */}
      {showSettingsModal && (
        <Modal title="Calendar configuration" subtitle="Hours, rules, exceptions, and shift templates" wide onClose={() => setShowSettingsModal(false)}>
          <div className="space-y-6">
            {/* Booking rules */}
            <div>
              <h3 className="font-display font-semibold mb-4">Booking Rules</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Max events per day (0 = unlimited)</label>
                  <input type="number" min={0} value={calendarSettings.maxEventsPerDay} onChange={e => updateCalendarSettings({maxEventsPerDay: Number(e.target.value)})} className="input-field w-full" />
                </div>
                <div>
                  <label className="form-label">Advance booking days (0 = unlimited)</label>
                  <input type="number" min={0} value={calendarSettings.advanceBookingDays} onChange={e => updateCalendarSettings({advanceBookingDays: Number(e.target.value)})} className="input-field w-full" />
                </div>
              </div>
              <label className="flex items-center gap-3 cursor-pointer mt-4">
                <input type="checkbox" checked={calendarSettings.requireApproval} onChange={e => updateCalendarSettings({requireApproval: e.target.checked})} className="w-4 h-4 rounded" />
                <div>
                  <p className="text-sm font-medium">Require manager approval</p>
                  <p className="text-xs text-muted-foreground">All customer requests land as "pending" until approved</p>
                </div>
              </label>
              <div className="mt-4">
                <label className="form-label">Booking page message</label>
                <textarea value={calendarSettings.bookingMessage} onChange={e => updateCalendarSettings({bookingMessage: e.target.value})} rows={2} className="input-field w-full resize-none" placeholder="Welcome message shown to customers…" />
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Booking hours (when customers can reserve) */}
            <div>
              <h3 className="font-display font-semibold">Booking hours</h3>
              <p className="text-xs text-muted-foreground mt-0.5 mb-4">When customers can book on your public booking page. Not staff shifts — those live in the Roster tab.</p>
              <div className="space-y-2">
                {calendarSettings.workingDays.map(wd => (
                  <div key={wd.dayOfWeek} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 w-20 cursor-pointer shrink-0">
                      <input type="checkbox" checked={wd.isOpen} onChange={e => updateWorkingDay(wd.dayOfWeek, {isOpen: e.target.checked})} className="w-4 h-4 rounded" />
                      <span className="text-sm font-medium">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][wd.dayOfWeek]}</span>
                    </label>
                    {wd.isOpen ? (
                      <div className="flex items-center gap-2">
                        <input type="time" value={wd.openTime} onChange={e => updateWorkingDay(wd.dayOfWeek, {openTime: e.target.value})} className="input-field text-sm py-1.5" />
                        <span className="text-muted-foreground">–</span>
                        <input type="time" value={wd.closeTime} onChange={e => updateWorkingDay(wd.dayOfWeek, {closeTime: e.target.value})} className="input-field text-sm py-1.5" />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Date exceptions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-display font-semibold">Booking exceptions</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">One-off holidays, closures, or special booking hours (overrides the weekly booking hours above)</p>
                </div>
                {!addingException && (
                  <button onClick={() => setAddingException(true)} className="btn-ghost text-sm flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                )}
              </div>

              {addingException && (
                <div className="mb-3 p-3 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Date *</label>
                      <input type="date" value={exceptionForm.date} onChange={e => setExceptionForm(f => ({...f, date: e.target.value}))} className="input-field w-full" />
                    </div>
                    <div>
                      <label className="form-label">Note (optional)</label>
                      <input type="text" value={exceptionForm.note} onChange={e => setExceptionForm(f => ({...f, note: e.target.value}))} className="input-field w-full" placeholder="Public holiday, Renovation…" />
                    </div>
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={exceptionForm.isClosed} onChange={e => setExceptionForm(f => ({...f, isClosed: e.target.checked}))} className="w-4 h-4 rounded" />
                    <span className="text-sm font-medium">Mark as closed (no bookings)</span>
                  </label>
                  {!exceptionForm.isClosed && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="form-label">Opens at</label>
                        <input type="time" value={exceptionForm.openTime} onChange={e => setExceptionForm(f => ({...f, openTime: e.target.value}))} className="input-field w-full" />
                      </div>
                      <div>
                        <label className="form-label">Closes at</label>
                        <input type="time" value={exceptionForm.closeTime} onChange={e => setExceptionForm(f => ({...f, closeTime: e.target.value}))} className="input-field w-full" />
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setAddingException(false)} className="btn-ghost text-sm px-3">Cancel</button>
                    <button onClick={saveException} className="btn-primary text-sm flex-1">Add exception</button>
                  </div>
                </div>
              )}

              {calendarSettings.workingExceptions.length === 0 && !addingException ? (
                <p className="text-sm text-muted-foreground">No exceptions yet.</p>
              ) : (
                <div className="space-y-2">
                  {[...calendarSettings.workingExceptions].sort((a,b) => a.date.localeCompare(b.date)).map(ex => (
                    <div key={ex.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${ex.isClosed ? 'bg-destructive' : 'bg-success'}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{new Date(ex.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</p>
                          <p className="text-xs text-muted-foreground">{ex.isClosed ? 'Closed' : `${ex.openTime}–${ex.closeTime}`}{ex.note ? ` · ${ex.note}` : ''}</p>
                        </div>
                      </div>
                      <button onClick={() => updateCalendarSettings({workingExceptions: calendarSettings.workingExceptions.filter(e => e.id !== ex.id)})} className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-border" />

            {/* Shift templates */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-display font-semibold flex items-center gap-1.5"><Layers className="w-4 h-4" /> Shift Templates</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Presets that pre-fill the shift form — name, times, color</p>
                </div>
                <button onClick={() => { setEditingTemplate(null); setShowTemplateForm(true); }} className="btn-ghost text-sm flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
              {shiftTemplates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No templates. Create presets like "Kitchen AM 9–17" to add shifts faster.</p>
              ) : (
                <div className="space-y-2">
                  {shiftTemplates.map(t => (
                    <div key={t.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-3 h-8 rounded-lg shrink-0" style={{ backgroundColor: t.color }} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.startTime}–{t.endTime}</p>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button onClick={() => { setEditingTemplate(t); setShowTemplateForm(true); }} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => { updateCalendarSettings({shiftTemplates: shiftTemplates.filter(x => x.id !== t.id)}); toast.success('Template removed'); }} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </Modal>
      )}

      {/* ── Event form modal ── */}
      {showEventForm && (
        <Modal title="New Event" onClose={() => setShowEventForm(false)}>
          <EventForm initialDate={selectedDate} packages={eventPackages}
            onSave={data => { addCalendarEvent(data); setShowEventForm(false); toast.success('Event added'); }}
            onClose={() => setShowEventForm(false)} />
        </Modal>
      )}

      {/* ── Package form modal ── */}
      {showPackageForm && (
        <Modal title={editingPackage ? 'Edit Package' : 'New Package'} onClose={() => { setShowPackageForm(false); setEditingPackage(null); }}>
          <PackageForm initial={editingPackage ?? undefined} sym={sym}
            onSave={data => {
              if (editingPackage) { updateEventPackage(editingPackage.id, data); toast.success('Updated'); }
              else { addEventPackage(data); toast.success('Created'); }
              setShowPackageForm(false); setEditingPackage(null);
            }}
            onClose={() => { setShowPackageForm(false); setEditingPackage(null); }} />
        </Modal>
      )}

      {/* ── Employee form modal ── */}
      {showEmployeeForm && (
        <Modal title={editingEmployee ? 'Edit Employee' : 'Add Employee'} onClose={() => { setShowEmployeeForm(false); setEditingEmployee(null); }}>
          <EmployeeForm initial={editingEmployee ?? undefined}
            onSave={data => {
              if (editingEmployee) { updateEmployee(editingEmployee.id, data); toast.success('Updated'); }
              else { addEmployee(data); toast.success('Added'); }
              setShowEmployeeForm(false); setEditingEmployee(null);
            }}
            onClose={() => { setShowEmployeeForm(false); setEditingEmployee(null); }} />
        </Modal>
      )}

      {/* ── Shift form modal ── */}
      {showShiftForm && (
        <Modal
          title={editingShift ? `Edit: ${editingShift.name}` : 'New Shift'}
          subtitle={editingShift ? `${editingShift.date} · ${editingShift.startTime}–${editingShift.endTime}` : 'Set up the time block — assign staff directly on the schedule'}
          wide
          onClose={() => { setShowShiftForm(false); setEditingShift(null); setShiftInitDate(undefined); }}>
          <ShiftForm
            initial={editingShift ?? undefined}
            initialDate={shiftInitDate}
            employees={employees}
            stations={stations}
            templates={shiftTemplates}
            onSave={data => {
              if (editingShift) {
                updateShift(editingShift.id, data);
                toast.success('Shift updated');
                setActiveShiftId(editingShift.id);  // reopen assignment panel
              } else {
                addShift(data);
                toast.success('Shift added');
              }
              setShowShiftForm(false); setEditingShift(null); setShiftInitDate(undefined);
            }}
            onClose={() => { setShowShiftForm(false); setEditingShift(null); setShiftInitDate(undefined); }} />
        </Modal>
      )}

      {/* ── Template form modal ── */}
      {showTemplateForm && (
        <Modal title={editingTemplate ? 'Edit Template' : 'New Shift Template'} onClose={() => { setShowTemplateForm(false); setEditingTemplate(null); }}>
          <ShiftTemplateForm initial={editingTemplate ?? undefined} onSave={saveTemplate}
            onClose={() => { setShowTemplateForm(false); setEditingTemplate(null); }} />
        </Modal>
      )}

      {/* ── Reject modal ── */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-lg">Reject request</h2>
              <button onClick={() => setRejectId(null)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">Optionally provide a reason for the customer.</p>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={2} className="input-field w-full resize-none mb-3" placeholder="e.g. Fully booked" />
            <div className="flex gap-2">
              <button onClick={() => setRejectId(null)} className="btn-ghost px-4">Cancel</button>
              <button onClick={handleReject} className="btn-primary flex-1">Reject</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
