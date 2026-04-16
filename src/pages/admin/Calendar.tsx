/**
 * Calendar — Reservations & Events management for managers.
 *
 * Tabs:
 *  - Calendar  : month view, day detail, pending request queue
 *  - Packages  : create/edit event packages (birthday, wedding, …)
 *  - Roster    : employee list + weekly shift grid
 *  - Settings  : working hours per weekday + exceptions, capacity, booking rules
 */
import { useState, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, Check, X, Clock, Users,
  CalendarDays, Settings2, Package, AlertCircle, Edit2, Trash2,
  Phone, Mail, Star, Link, UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { CalendarEvent, CalendarEventType, EventPackage, WorkingDay, Employee, Shift } from '@/domain/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function today() {
  return isoDate(new Date());
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-warning text-warning-foreground',
  approved:  'bg-success text-success-foreground',
  rejected:  'bg-destructive text-destructive-foreground',
  cancelled: 'bg-muted text-muted-foreground',
  completed: 'bg-primary/20 text-primary',
};

const TYPE_EMOJI: Record<CalendarEventType, string> = {
  reservation:   '🪑',
  private_event: '🎉',
  closure:       '🔒',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[status] ?? 'bg-muted'}`}>
      {status}
    </span>
  );
}

// ─── Event form ───────────────────────────────────────────────────────────────

interface EventFormProps {
  initialDate?: string;
  packages: EventPackage[];
  onSave: (data: Omit<CalendarEvent, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

function EventForm({ initialDate, packages, onSave, onClose }: EventFormProps) {
  const [form, setForm] = useState({
    date:         initialDate ?? today(),
    timeSlot:     '18:00',
    endTime:      '21:00',
    type:         'reservation' as CalendarEventType,
    customerName:  '',
    customerPhone: '',
    customerEmail: '',
    guestCount:   2,
    packageId:    '',
    notes:        '',
    closureReason: '',
    status:       'approved' as CalendarEvent['status'],
  });

  const isClosure = form.type === 'closure';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isClosure && !form.customerName.trim()) {
      toast.error('Customer name is required');
      return;
    }
    const pkg = packages.find(p => p.id === form.packageId);
    onSave({
      date:         form.date,
      timeSlot:     form.timeSlot,
      endTime:      form.endTime || undefined,
      type:         form.type,
      status:       form.status,
      customerName:  isClosure ? '' : form.customerName,
      customerPhone: isClosure ? '' : form.customerPhone,
      customerEmail: isClosure ? '' : form.customerEmail,
      guestCount:   isClosure ? 0 : form.guestCount,
      packageId:    form.packageId || undefined,
      packageName:  pkg?.name,
      notes:        form.notes,
      closureReason: isClosure ? form.closureReason : undefined,
      createdBy:    'manager',
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Date</label>
          <input
            type="date" value={form.date}
            onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            className="input-field w-full"
            required
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Type</label>
          <select
            value={form.type}
            onChange={e => setForm(f => ({ ...f, type: e.target.value as CalendarEventType }))}
            className="input-field w-full"
          >
            <option value="reservation">Reservation</option>
            <option value="private_event">Private Event</option>
            <option value="closure">Closure / Blocked</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Start time</label>
          <input
            type="time" value={form.timeSlot}
            onChange={e => setForm(f => ({ ...f, timeSlot: e.target.value }))}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">End time</label>
          <input
            type="time" value={form.endTime}
            onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
            className="input-field w-full"
          />
        </div>
      </div>

      {isClosure ? (
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Reason</label>
          <input
            type="text" value={form.closureReason}
            onChange={e => setForm(f => ({ ...f, closureReason: e.target.value }))}
            placeholder="e.g. Private party, Holiday, Renovation…"
            className="input-field w-full"
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Customer name *</label>
              <input
                type="text" value={form.customerName}
                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                className="input-field w-full" required
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Guests</label>
              <input
                type="number" min={1} max={500} value={form.guestCount}
                onChange={e => setForm(f => ({ ...f, guestCount: Number(e.target.value) }))}
                className="input-field w-full"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Phone</label>
              <input
                type="tel" value={form.customerPhone}
                onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Email</label>
              <input
                type="email" value={form.customerEmail}
                onChange={e => setForm(f => ({ ...f, customerEmail: e.target.value }))}
                className="input-field w-full"
              />
            </div>
          </div>
          {packages.filter(p => p.active).length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground font-medium mb-1 block">Package (optional)</label>
              <select
                value={form.packageId}
                onChange={e => setForm(f => ({ ...f, packageId: e.target.value }))}
                className="input-field w-full"
              >
                <option value="">No package</option>
                {packages.filter(p => p.active).map(p => (
                  <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">Notes</label>
        <textarea
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          rows={2}
          className="input-field w-full resize-none"
          placeholder="Special requests, dietary requirements…"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">Status</label>
        <select
          value={form.status}
          onChange={e => setForm(f => ({ ...f, status: e.target.value as CalendarEvent['status'] }))}
          className="input-field w-full"
        >
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1">Save event</button>
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
      </div>
    </form>
  );
}

// ─── Package form ─────────────────────────────────────────────────────────────

interface PackageFormProps {
  initial?: Partial<EventPackage>;
  onSave: (data: Omit<EventPackage, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}

function PackageForm({ initial, onSave, onClose }: PackageFormProps) {
  const [form, setForm] = useState({
    name:           initial?.name ?? '',
    emoji:          initial?.emoji ?? '🎉',
    description:    initial?.description ?? '',
    minGuests:      initial?.minGuests ?? 10,
    maxGuests:      initial?.maxGuests ?? 100,
    fixedPrice:     initial?.fixedPrice ?? undefined as number | undefined,
    pricePerPerson: initial?.pricePerPerson ?? undefined as number | undefined,
    duration:       initial?.duration ?? 3,
    details:        initial?.details ?? '',
    active:         initial?.active ?? true,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Package name required'); return; }
    onSave(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Icon</label>
          <input
            type="text" value={form.emoji} maxLength={2}
            onChange={e => setForm(f => ({ ...f, emoji: e.target.value }))}
            className="input-field w-full text-center text-2xl"
          />
        </div>
        <div className="col-span-3">
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Package name *</label>
          <input
            type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Birthday Party, Wedding Reception…"
            className="input-field w-full" required
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">Description</label>
        <input
          type="text" value={form.description}
          onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          className="input-field w-full"
          placeholder="Short description shown to customers"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Min guests</label>
          <input
            type="number" min={1} value={form.minGuests}
            onChange={e => setForm(f => ({ ...f, minGuests: Number(e.target.value) }))}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Max guests</label>
          <input
            type="number" min={1} value={form.maxGuests}
            onChange={e => setForm(f => ({ ...f, maxGuests: Number(e.target.value) }))}
            className="input-field w-full"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Duration (hrs)</label>
          <input
            type="number" min={0.5} step={0.5} value={form.duration}
            onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}
            className="input-field w-full"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Fixed price (optional)</label>
          <input
            type="number" min={0} step={0.01}
            value={form.fixedPrice ?? ''}
            onChange={e => setForm(f => ({ ...f, fixedPrice: e.target.value ? Number(e.target.value) : undefined }))}
            className="input-field w-full"
            placeholder="Leave blank if per-person"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground font-medium mb-1 block">Price per person (optional)</label>
          <input
            type="number" min={0} step={0.01}
            value={form.pricePerPerson ?? ''}
            onChange={e => setForm(f => ({ ...f, pricePerPerson: e.target.value ? Number(e.target.value) : undefined }))}
            className="input-field w-full"
            placeholder="Leave blank if fixed"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground font-medium mb-1 block">What's included / requirements</label>
        <textarea
          value={form.details}
          onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
          rows={3}
          className="input-field w-full resize-none"
          placeholder="e.g. Dedicated area, custom cake, balloon decoration, 3-course meal…"
        />
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox" checked={form.active}
          onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
          className="rounded"
        />
        <span className="text-sm font-medium">Active (visible to customers)</span>
      </label>

      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1">Save package</button>
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
      </div>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = 'calendar' | 'packages' | 'roster' | 'settings';

// ─── Employee form ─────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316',
  '#eab308','#22c55e','#14b8a6','#0ea5e9','#64748b',
];

interface EmployeeFormProps {
  initial?: Employee;
  onSave: (data: Omit<Employee, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}

function EmployeeForm({ initial, onSave, onClose }: EmployeeFormProps) {
  const [form, setForm] = useState({
    name:   initial?.name   ?? '',
    role:   initial?.role   ?? '',
    phone:  initial?.phone  ?? '',
    email:  initial?.email  ?? '',
    color:  initial?.color  ?? PRESET_COLORS[0],
    active: initial?.active ?? true,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSave({ name: form.name.trim(), role: form.role.trim(), phone: form.phone.trim() || undefined, email: form.email.trim() || undefined, color: form.color, active: form.active });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Name *</label>
        <input type="text" required value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          className="input-field w-full" placeholder="Full name" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Role / Position</label>
        <input type="text" value={form.role}
          onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          className="input-field w-full" placeholder="Chef, Server, Bartender…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block"><Phone className="w-3 h-3 inline mr-0.5" /> Phone</label>
          <input type="tel" value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="input-field w-full" placeholder="+1 234…" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block"><Mail className="w-3 h-3 inline mr-0.5" /> Email</label>
          <input type="email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="input-field w-full" placeholder="staff@…" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Color</label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map(c => (
            <button key={c} type="button"
              onClick={() => setForm(f => ({ ...f, color: c }))}
              className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active}
          onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
          className="w-4 h-4 rounded" />
        <span className="text-sm font-medium">Active (show in roster)</span>
      </label>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1">Save employee</button>
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
      </div>
    </form>
  );
}

// ─── Shift form ────────────────────────────────────────────────────────────────

interface ShiftFormProps {
  initial?: Shift;
  initialDate?: string;
  employees: Employee[];
  onSave: (data: Omit<Shift, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}

function ShiftForm({ initial, initialDate, employees, onSave, onClose }: ShiftFormProps) {
  const [form, setForm] = useState({
    date:        initial?.date      ?? initialDate ?? new Date().toISOString().slice(0, 10),
    startTime:   initial?.startTime ?? '09:00',
    endTime:     initial?.endTime   ?? '17:00',
    role:        initial?.role      ?? '',
    employeeIds: initial?.employeeIds ?? [] as string[],
    minStaff:    initial?.minStaff   ?? 1,
    notes:       initial?.notes      ?? '',
  });

  function toggleEmployee(id: string) {
    setForm(f => ({
      ...f,
      employeeIds: f.employeeIds.includes(id)
        ? f.employeeIds.filter(e => e !== id)
        : [...f.employeeIds, id],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ date: form.date, startTime: form.startTime, endTime: form.endTime, role: form.role.trim(), employeeIds: form.employeeIds, minStaff: form.minStaff, notes: form.notes.trim() });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Date *</label>
        <input type="date" required value={form.date}
          onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
          className="input-field w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Start</label>
          <input type="time" value={form.startTime}
            onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))}
            className="input-field w-full" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">End</label>
          <input type="time" value={form.endTime}
            onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
            className="input-field w-full" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Shift label</label>
        <input type="text" value={form.role}
          onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
          className="input-field w-full" placeholder="Kitchen, Bar, Floor…" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Assign staff</label>
        {employees.length === 0 ? (
          <p className="text-xs text-muted-foreground">Add employees first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {employees.filter(e => e.active).map(emp => (
              <button key={emp.id} type="button"
                onClick={() => toggleEmployee(emp.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  form.employeeIds.includes(emp.id)
                    ? 'text-white border-transparent'
                    : 'border-border text-muted-foreground hover:border-primary'
                }`}
                style={form.employeeIds.includes(emp.id) ? { backgroundColor: emp.color, borderColor: emp.color } : {}}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: emp.color }} />
                {emp.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Min. staff needed</label>
        <input type="number" min={0} max={50} value={form.minStaff}
          onChange={e => setForm(f => ({ ...f, minStaff: Number(e.target.value) }))}
          className="input-field w-28" />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground mb-1 block">Notes</label>
        <textarea rows={2} value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          className="input-field w-full resize-none" placeholder="Optional notes…" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="btn-primary flex-1">Save shift</button>
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
      </div>
    </form>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const {
    calendarEvents, eventPackages, calendarSettings, settings, user,
    employees, shifts,
    addCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
    approveCalendarEvent, rejectCalendarEvent,
    addEventPackage, updateEventPackage, deleteEventPackage,
    updateCalendarSettings,
    addEmployee, updateEmployee, deleteEmployee,
    addShift, updateShift, deleteShift,
  } = useStore(useShallow(s => ({
    calendarEvents:       s.calendarEvents,
    eventPackages:        s.eventPackages,
    calendarSettings:     s.calendarSettings,
    settings:             s.settings,
    user:                 s.user,
    employees:            s.employees,
    shifts:               s.shifts,
    addCalendarEvent:     s.addCalendarEvent,
    updateCalendarEvent:  s.updateCalendarEvent,
    deleteCalendarEvent:  s.deleteCalendarEvent,
    approveCalendarEvent: s.approveCalendarEvent,
    rejectCalendarEvent:  s.rejectCalendarEvent,
    addEventPackage:      s.addEventPackage,
    updateEventPackage:   s.updateEventPackage,
    deleteEventPackage:   s.deleteEventPackage,
    updateCalendarSettings: s.updateCalendarSettings,
    addEmployee:          s.addEmployee,
    updateEmployee:       s.updateEmployee,
    deleteEmployee:       s.deleteEmployee,
    addShift:             s.addShift,
    updateShift:          s.updateShift,
    deleteShift:          s.deleteShift,
  })));

  const sym = settings.currencySymbol;

  const [tab, setTab]           = useState<Tab>('calendar');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(today());
  const [showEventForm, setShowEventForm]   = useState(false);
  const [showPackageForm, setShowPackageForm] = useState(false);
  const [editingPackage, setEditingPackage]   = useState<EventPackage | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Roster state ──────────────────────────────────────────────────────────────
  const [rosterWeekOffset, setRosterWeekOffset] = useState(0);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [editingEmployee, setEditingEmployee]   = useState<Employee | null>(null);
  const [showShiftForm, setShowShiftForm]       = useState(false);
  const [editingShift, setEditingShift]         = useState<Shift | null>(null);
  const [shiftInitDate, setShiftInitDate]       = useState<string | undefined>();

  // ── Calendar grid helpers ────────────────────────────────────────────────────

  const year  = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Events indexed by date string
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    calendarEvents.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [calendarEvents]);

  const pendingEvents = useMemo(
    () => calendarEvents.filter(e => e.status === 'pending').sort((a, b) => a.date.localeCompare(b.date)),
    [calendarEvents],
  );

  // Working day check
  function isWorkingDay(dateStr: string): boolean {
    const d = new Date(dateStr);
    const dow = d.getDay() as WorkingDay['dayOfWeek'];
    const exception = calendarSettings.workingExceptions.find(ex => ex.date === dateStr);
    if (exception) return !exception.isClosed;
    return calendarSettings.workingDays.find(wd => wd.dayOfWeek === dow)?.isOpen ?? false;
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function prevMonth() {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  function handleApprove(id: string) {
    approveCalendarEvent(id, user?.name ?? 'Manager');
    toast.success('Request approved');
  }

  function handleReject() {
    if (!rejectId) return;
    rejectCalendarEvent(rejectId, rejectReason);
    setRejectId(null);
    setRejectReason('');
    toast.success('Request rejected');
  }

  function handleDeleteEvent(id: string) {
    if (confirm('Delete this event?')) {
      deleteCalendarEvent(id);
    }
  }

  // ── Roster helpers ────────────────────────────────────────────────────────────

  /** Monday–Sunday for the current roster week. */
  const rosterWeekDays = useMemo(() => {
    const base = new Date();
    const day  = base.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    base.setDate(base.getDate() + diff + rosterWeekOffset * 7);
    base.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }, [rosterWeekOffset]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const sh of shifts) {
      if (!map.has(sh.date)) map.set(sh.date, []);
      map.get(sh.date)!.push(sh);
    }
    return map;
  }, [shifts]);

  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const emp of employees) map.set(emp.id, emp);
    return map;
  }, [employees]);

  const rosterLink = `${window.location.origin}/roster/${settings.restaurantToken}`;

  // ── Working hours settings form ────────────────────────────────────────────

  function updateWorkingDay(dow: number, updates: Partial<WorkingDay>) {
    const next = calendarSettings.workingDays.map(d =>
      d.dayOfWeek === dow ? { ...d, ...updates } : d,
    );
    updateCalendarSettings({ workingDays: next });
  }

  function addException() {
    const date = prompt('Enter date (YYYY-MM-DD):');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const existing = calendarSettings.workingExceptions.find(e => e.date === date);
    if (existing) { toast.error('Exception already exists for that date'); return; }
    const note = prompt('Note (e.g. Christmas, Private party):') ?? '';
    const isClosed = confirm('Mark as CLOSED? (Cancel = custom hours)');
    updateCalendarSettings({
      workingExceptions: [
        ...calendarSettings.workingExceptions,
        { id: crypto.randomUUID(), date, isClosed, note, openTime: '09:00', closeTime: '22:00' },
      ],
    });
  }

  function removeException(id: string) {
    updateCalendarSettings({
      workingExceptions: calendarSettings.workingExceptions.filter(e => e.id !== id),
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const selectedDayEvents = eventsByDate[selectedDate] ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Calendar</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Reservations, events & working hours</p>
          </div>
          <div className="flex items-center gap-2">
            {pendingEvents.length > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-warning px-2.5 py-1 bg-warning/10 rounded-lg">
                <AlertCircle className="w-3.5 h-3.5" />
                {pendingEvents.length} pending
              </span>
            )}
            <button
              onClick={() => setShowEventForm(true)}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New event
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-border overflow-x-auto">
          {(['calendar', 'packages', 'roster', 'settings'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px whitespace-nowrap ${
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'calendar' && <CalendarDays className="w-3.5 h-3.5 inline mr-1.5" />}
              {t === 'packages' && <Package className="w-3.5 h-3.5 inline mr-1.5" />}
              {t === 'roster'   && <Users className="w-3.5 h-3.5 inline mr-1.5" />}
              {t === 'settings' && <Settings2 className="w-3.5 h-3.5 inline mr-1.5" />}
              {t}
            </button>
          ))}
        </div>

        {/* ── CALENDAR TAB ── */}
        {tab === 'calendar' && (
          <div className="grid lg:grid-cols-3 gap-5">

            {/* Month view */}
            <div className="lg:col-span-2 glass-card p-5">
              {/* Month nav */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <h2 className="font-display font-bold text-lg">
                  {MONTH_NAMES[month]} {year}
                </h2>
                <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Day name headers */}
              <div className="grid grid-cols-7 mb-1">
                {DAY_NAMES.map(d => (
                  <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">{d}</div>
                ))}
              </div>

              {/* Day cells */}
              <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden">
                {/* Leading blanks */}
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`blank-${i}`} className="bg-card h-14 sm:h-16" />
                ))}

                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayEvents = eventsByDate[dateStr] ?? [];
                  const isToday   = dateStr === today();
                  const isSelected = dateStr === selectedDate;
                  const working   = isWorkingDay(dateStr);
                  const hasPending = dayEvents.some(e => e.status === 'pending');

                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDate(dateStr)}
                      className={`bg-card h-14 sm:h-16 p-1.5 flex flex-col items-start transition-colors hover:bg-muted/50 ${
                        isSelected ? 'ring-2 ring-inset ring-primary' : ''
                      } ${!working ? 'opacity-40' : ''}`}
                    >
                      <span className={`text-xs font-semibold w-5 h-5 flex items-center justify-center rounded-full ${
                        isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                      }`}>
                        {day}
                      </span>

                      {/* Event dots */}
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {hasPending && (
                          <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                        )}
                        {dayEvents.filter(e => e.status === 'approved').length > 0 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                        )}
                        {dayEvents.some(e => e.type === 'closure') && (
                          <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                        )}
                      </div>

                      {dayEvents.length > 0 && (
                        <span className="text-[9px] text-muted-foreground mt-auto">
                          {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="flex gap-4 mt-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> Approved</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-warning" /> Pending</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" /> Blocked</span>
                <span className="flex items-center gap-1 ml-auto opacity-50">Greyed = closed day</span>
              </div>
            </div>

            {/* Right panel: day detail + pending queue */}
            <div className="space-y-4">

              {/* Selected day */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold text-sm">
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </h3>
                  <button
                    onClick={() => setShowEventForm(true)}
                    className="text-primary hover:underline text-xs font-semibold"
                  >
                    + Add
                  </button>
                </div>

                {selectedDayEvents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No events on this day.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedDayEvents
                      .sort((a, b) => a.timeSlot.localeCompare(b.timeSlot))
                      .map(ev => (
                        <div key={ev.id} className="p-2.5 rounded-xl border border-border bg-muted/20">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-sm">{TYPE_EMOJI[ev.type]}</span>
                                <span className="text-xs font-semibold truncate">
                                  {ev.type === 'closure' ? (ev.closureReason || 'Closed') : ev.customerName}
                                </span>
                                <StatusBadge status={ev.status} />
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span><Clock className="w-3 h-3 inline" /> {ev.timeSlot}{ev.endTime ? `–${ev.endTime}` : ''}</span>
                                {ev.guestCount > 0 && <span><Users className="w-3 h-3 inline" /> {ev.guestCount}</span>}
                              </div>
                              {ev.packageName && (
                                <span className="text-[10px] text-primary font-medium">{ev.packageName}</span>
                              )}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {ev.status === 'pending' && (
                                <>
                                  <button onClick={() => handleApprove(ev.id)} className="p-1 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors">
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => setRejectId(ev.id)} className="p-1 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              )}
                              <button onClick={() => handleDeleteEvent(ev.id)} className="p-1 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                          {ev.notes && <p className="text-[11px] text-muted-foreground mt-1 truncate">{ev.notes}</p>}
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Pending queue */}
              {pendingEvents.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="font-display font-semibold text-sm mb-3 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-warning" />
                    Pending requests ({pendingEvents.length})
                  </h3>
                  <div className="space-y-2">
                    {pendingEvents.slice(0, 5).map(ev => (
                      <div key={ev.id} className="p-2.5 rounded-xl bg-warning/5 border border-warning/20">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{ev.customerName}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {ev.timeSlot} · {ev.guestCount} guests
                            </p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => handleApprove(ev.id)} className="p-1 rounded-lg bg-success/10 text-success hover:bg-success/20 transition-colors">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setRejectId(ev.id)} className="p-1 rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {ev.packageName && (
                          <p className="text-[10px] text-primary mt-0.5">{ev.packageName}</p>
                        )}
                        {ev.notes && (
                          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{ev.notes}</p>
                        )}
                      </div>
                    ))}
                    {pendingEvents.length > 5 && (
                      <p className="text-[11px] text-muted-foreground text-center">+{pendingEvents.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PACKAGES TAB ── */}
        {tab === 'packages' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Create event packages customers can select when booking (birthday, wedding, etc.)
              </p>
              <button onClick={() => { setEditingPackage(null); setShowPackageForm(true); }} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> New package
              </button>
            </div>

            {eventPackages.length === 0 ? (
              <div className="glass-card p-12 text-center">
                <Star className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="font-semibold text-muted-foreground">No packages yet</p>
                <p className="text-sm text-muted-foreground mt-1">Create your first event package — birthday parties, weddings, corporate events…</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {eventPackages.map(pkg => (
                  <div key={pkg.id} className={`glass-card p-4 ${!pkg.active ? 'opacity-50' : ''}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{pkg.emoji}</span>
                        <div>
                          <p className="font-semibold text-sm">{pkg.name}</p>
                          {!pkg.active && <span className="text-[10px] text-muted-foreground">inactive</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => { setEditingPackage(pkg); setShowPackageForm(true); }}
                          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm('Delete package?')) deleteEventPackage(pkg.id); }}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    {pkg.description && <p className="text-xs text-muted-foreground mb-2">{pkg.description}</p>}
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {pkg.minGuests}–{pkg.maxGuests}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {pkg.duration}h</span>
                      {pkg.fixedPrice != null && <span className="font-semibold text-foreground">{sym}{pkg.fixedPrice}</span>}
                      {pkg.pricePerPerson != null && <span className="font-semibold text-foreground">{sym}{pkg.pricePerPerson}/person</span>}
                    </div>
                    {pkg.details && (
                      <p className="text-[11px] text-muted-foreground mt-2 line-clamp-2">{pkg.details}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ROSTER TAB ── */}
        {tab === 'roster' && (
          <div className="space-y-5">

            {/* Roster header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="font-display font-semibold">Staff Roster</h2>
                <p className="text-sm text-muted-foreground">Manage employees and weekly shifts</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(rosterLink); toast.success('Roster link copied!'); }}
                  className="btn-ghost flex items-center gap-1.5 text-sm"
                >
                  <Link className="w-3.5 h-3.5" /> Copy staff link
                </button>
                <button
                  onClick={() => { setEditingEmployee(null); setShowEmployeeForm(true); }}
                  className="btn-primary flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" /> Add employee
                </button>
              </div>
            </div>

            {/* Employees list */}
            {employees.length > 0 && (
              <div className="glass-card p-4">
                <h3 className="font-semibold text-sm mb-3">Employees</h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {employees.map(emp => (
                    <div key={emp.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-border bg-muted/20">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: emp.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{emp.name}</p>
                        {emp.role && <p className="text-xs text-muted-foreground">{emp.role}</p>}
                      </div>
                      {!emp.active && (
                        <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">inactive</span>
                      )}
                      <div className="flex gap-1">
                        <button onClick={() => { setEditingEmployee(emp); setShowEmployeeForm(true); }}
                          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button onClick={() => {
                          if (confirm(`Remove ${emp.name}?`)) deleteEmployee(emp.id);
                        }} className="p-1.5 rounded-lg hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Weekly shift grid */}
            <div className="glass-card p-4">
              {/* Week navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => setRosterWeekOffset(w => w - 1)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="text-center">
                  <p className="font-semibold text-sm">
                    {new Date(rosterWeekDays[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(rosterWeekDays[6] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  {rosterWeekOffset !== 0 && (
                    <button onClick={() => setRosterWeekOffset(0)}
                      className="text-xs text-primary hover:underline">This week</button>
                  )}
                </div>
                <button onClick={() => setRosterWeekOffset(w => w + 1)}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Day columns */}
              <div className="grid grid-cols-7 gap-2">
                {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((label, i) => {
                  const dateStr   = rosterWeekDays[i];
                  const dayShifts = shiftsByDate.get(dateStr) ?? [];
                  const isToday   = dateStr === today();

                  return (
                    <div key={dateStr} className="flex flex-col gap-2">
                      {/* Day header */}
                      <div className={`text-center py-1 rounded-xl text-xs font-semibold ${isToday ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
                        <div>{label}</div>
                        <div className={`text-base font-bold ${isToday ? 'text-primary' : 'text-foreground'}`}>
                          {new Date(dateStr + 'T12:00:00').getDate()}
                        </div>
                      </div>

                      {/* Shifts for this day */}
                      {dayShifts.map(shift => {
                        const assigned = shift.employeeIds
                          .map(id => employeeMap.get(id))
                          .filter(Boolean) as Employee[];
                        const understaffed = assigned.length < shift.minStaff;

                        return (
                          <div key={shift.id}
                            className={`rounded-xl p-2 border text-xs space-y-1 ${understaffed ? 'border-warning/60 bg-warning/5' : 'border-border bg-muted/30'}`}>
                            <div className="flex items-start justify-between gap-1">
                              <div>
                                <p className="font-semibold truncate">{shift.role || 'Shift'}</p>
                                <p className="font-mono text-[10px] text-muted-foreground">{shift.startTime}–{shift.endTime}</p>
                              </div>
                              <div className="flex gap-0.5 shrink-0">
                                <button onClick={() => { setEditingShift(shift); setShowShiftForm(true); }}
                                  className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground">
                                  <Edit2 className="w-2.5 h-2.5" />
                                </button>
                                <button onClick={() => { if (confirm('Delete shift?')) deleteShift(shift.id); }}
                                  className="p-0.5 rounded hover:bg-destructive/10 transition-colors text-muted-foreground hover:text-destructive">
                                  <Trash2 className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            </div>
                            {/* Employee pills */}
                            <div className="flex flex-wrap gap-0.5">
                              {assigned.map(emp => (
                                <span key={emp.id}
                                  className="px-1.5 py-0.5 rounded-full text-[10px] text-white font-medium"
                                  style={{ backgroundColor: emp.color }}>
                                  {emp.name.split(' ')[0]}
                                </span>
                              ))}
                              {assigned.length === 0 && (
                                <span className="text-[10px] text-muted-foreground/60 italic">Unassigned</span>
                              )}
                            </div>
                            {understaffed && (
                              <p className="text-[10px] text-warning font-medium">
                                Need {shift.minStaff - assigned.length} more
                              </p>
                            )}
                          </div>
                        );
                      })}

                      {/* Add shift button */}
                      <button
                        onClick={() => { setEditingShift(null); setShiftInitDate(dateStr); setShowShiftForm(true); }}
                        className="text-[10px] text-muted-foreground hover:text-primary border border-dashed border-border hover:border-primary rounded-xl py-1.5 transition-colors text-center"
                      >
                        + shift
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && (
          <div className="space-y-5 max-w-2xl">

            {/* Booking rules */}
            <div className="glass-card p-5 space-y-4">
              <h3 className="font-display font-semibold">Booking Rules</h3>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Max events per day (0 = unlimited)</label>
                  <input
                    type="number" min={0}
                    value={calendarSettings.maxEventsPerDay}
                    onChange={e => updateCalendarSettings({ maxEventsPerDay: Number(e.target.value) })}
                    className="input-field w-full"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium mb-1 block">Advance booking days (0 = unlimited)</label>
                  <input
                    type="number" min={0}
                    value={calendarSettings.advanceBookingDays}
                    onChange={e => updateCalendarSettings({ advanceBookingDays: Number(e.target.value) })}
                    className="input-field w-full"
                  />
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={calendarSettings.requireApproval}
                  onChange={e => updateCalendarSettings({ requireApproval: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <div>
                  <p className="text-sm font-medium">Require manager approval for all bookings</p>
                  <p className="text-xs text-muted-foreground">When on, all customer requests land as "pending" until approved</p>
                </div>
              </label>

              <div>
                <label className="text-xs text-muted-foreground font-medium mb-1 block">Message shown to customers on booking page</label>
                <textarea
                  value={calendarSettings.bookingMessage}
                  onChange={e => updateCalendarSettings({ bookingMessage: e.target.value })}
                  rows={2}
                  className="input-field w-full resize-none"
                />
              </div>
            </div>

            {/* Working hours */}
            <div className="glass-card p-5">
              <h3 className="font-display font-semibold mb-4">Working Hours</h3>
              <div className="space-y-2">
                {calendarSettings.workingDays.map(wd => (
                  <div key={wd.dayOfWeek} className="flex items-center gap-3">
                    <label className="flex items-center gap-2 w-24 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={wd.isOpen}
                        onChange={e => updateWorkingDay(wd.dayOfWeek, { isOpen: e.target.checked })}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm font-medium">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][wd.dayOfWeek]}</span>
                    </label>
                    {wd.isOpen ? (
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="time" value={wd.openTime}
                          onChange={e => updateWorkingDay(wd.dayOfWeek, { openTime: e.target.value })}
                          className="input-field text-sm py-1.5"
                        />
                        <span className="text-muted-foreground text-sm">–</span>
                        <input
                          type="time" value={wd.closeTime}
                          onChange={e => updateWorkingDay(wd.dayOfWeek, { closeTime: e.target.value })}
                          className="input-field text-sm py-1.5"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-muted-foreground">Closed</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Exceptions */}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold">Date Exceptions</h3>
                <button onClick={addException} className="btn-ghost text-sm flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Add exception
                </button>
              </div>
              {calendarSettings.workingExceptions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No exceptions. Add specific dates that differ from the weekly schedule (holidays, private events, etc.)</p>
              ) : (
                <div className="space-y-2">
                  {[...calendarSettings.workingExceptions]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(ex => (
                      <div key={ex.id} className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${ex.isClosed ? 'bg-destructive' : 'bg-success'}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {new Date(ex.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {ex.isClosed ? 'Closed' : `${ex.openTime}–${ex.closeTime}`}
                              {ex.note ? ` · ${ex.note}` : ''}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => removeException(ex.id)}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Booking link */}
            <div className="glass-card p-5">
              <h3 className="font-display font-semibold mb-2">Customer Booking Link</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Share this link so customers can submit booking requests. They will only see available days and your configured packages.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg font-mono break-all">
                  {window.location.origin}/book/{settings.restaurantToken}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/book/${settings.restaurantToken}`);
                    toast.success('Link copied!');
                  }}
                  className="btn-ghost text-sm shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── New event modal ── */}
      {showEventForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-display font-bold text-lg mb-4">New Event</h2>
            <EventForm
              initialDate={selectedDate}
              packages={eventPackages}
              onSave={data => {
                addCalendarEvent(data);
                setShowEventForm(false);
                toast.success('Event added');
              }}
              onClose={() => setShowEventForm(false)}
            />
          </div>
        </div>
      )}

      {/* ── Package modal ── */}
      {showPackageForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-display font-bold text-lg mb-4">
              {editingPackage ? 'Edit Package' : 'New Package'}
            </h2>
            <PackageForm
              initial={editingPackage ?? undefined}
              onSave={data => {
                if (editingPackage) {
                  updateEventPackage(editingPackage.id, data);
                  toast.success('Package updated');
                } else {
                  addEventPackage(data);
                  toast.success('Package created');
                }
                setShowPackageForm(false);
                setEditingPackage(null);
              }}
              onClose={() => { setShowPackageForm(false); setEditingPackage(null); }}
            />
          </div>
        </div>
      )}

      {/* ── Employee modal ── */}
      {showEmployeeForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-display font-bold text-lg mb-4">
              {editingEmployee ? 'Edit Employee' : 'Add Employee'}
            </h2>
            <EmployeeForm
              initial={editingEmployee ?? undefined}
              onSave={data => {
                if (editingEmployee) {
                  updateEmployee(editingEmployee.id, data);
                  toast.success('Employee updated');
                } else {
                  addEmployee(data);
                  toast.success('Employee added');
                }
                setShowEmployeeForm(false);
                setEditingEmployee(null);
              }}
              onClose={() => { setShowEmployeeForm(false); setEditingEmployee(null); }}
            />
          </div>
        </div>
      )}

      {/* ── Shift modal ── */}
      {showShiftForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h2 className="font-display font-bold text-lg mb-4">
              {editingShift ? 'Edit Shift' : 'Add Shift'}
            </h2>
            <ShiftForm
              initial={editingShift ?? undefined}
              initialDate={shiftInitDate}
              employees={employees}
              onSave={data => {
                if (editingShift) {
                  updateShift(editingShift.id, data);
                  toast.success('Shift updated');
                } else {
                  addShift(data);
                  toast.success('Shift added');
                }
                setShowShiftForm(false);
                setEditingShift(null);
                setShiftInitDate(undefined);
              }}
              onClose={() => { setShowShiftForm(false); setEditingShift(null); setShiftInitDate(undefined); }}
            />
          </div>
        </div>
      )}

      {/* ── Reject reason modal ── */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm">
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-5">
            <h2 className="font-display font-bold text-lg mb-2">Reject request</h2>
            <p className="text-sm text-muted-foreground mb-3">Optionally provide a reason for the customer.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={2}
              className="input-field w-full resize-none mb-3"
              placeholder="e.g. Fully booked on that date"
            />
            <div className="flex gap-2">
              <button onClick={handleReject} className="btn-primary flex-1">Reject</button>
              <button onClick={() => setRejectId(null)} className="btn-ghost px-4">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
