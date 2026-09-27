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
import { ChevronLeft, ChevronRight, Plus, Check, X, Clock, Users, CalendarDays, Settings2, Package, AlertCircle, Edit2, Trash2, Link, UserPlus, Layers, History, LayoutGrid, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import type { CalendarEvent, EventPackage, WorkingDay, Employee, Shift, ShiftAssignment, ShiftTemplate } from '@/domain/types';
import { localDateKey } from '@/domain/time/restaurantTime';
import { MONTH_NAMES, DAY_NAMES, today, initials, TYPE_EMOJI, TYPE_LABEL, Tab, RosterView } from './calendar/shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import Modal from './calendar/Modal';
import StatusBadge from './calendar/StatusBadge';
import EventForm from './calendar/EventForm';
import PackageForm from './calendar/PackageForm';
import EmployeeForm from './calendar/EmployeeForm';
import ShiftForm from './calendar/ShiftForm';
import ShiftTemplateForm from './calendar/ShiftTemplateForm';
import WeekTemplateEditor from './calendar/WeekTemplateEditor';
import ShiftAssignPanel from './calendar/ShiftAssignPanel';
import WorkLog from './calendar/WorkLog';

export default function CalendarPage() {
  const {
    calendarEvents, eventPackages, calendarSettings, settings, user,
    employees, shifts,
    addCalendarEvent, deleteCalendarEvent,
    approveCalendarEvent, rejectCalendarEvent,
    addEventPackage, updateEventPackage, deleteEventPackage,
    updateCalendarSettings,
    addEmployee, updateEmployee,
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
  useEscapeKey(() => setRejectId(null), rejectId !== null);
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
  const [settingsSection, setSettingsSection]       = useState<'booking' | 'roster'>('booking');

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
      const d = new Date(base); d.setDate(base.getDate() + i); return localDateKey(d);
    });
  }, [rosterWeekOffset]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const sh of shifts) { if (!map.has(sh.date)) map.set(sh.date, []); map.get(sh.date)!.push(sh); }
    return map;
  }, [shifts]);

  const employeeMap = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const rosterLink   = `${window.location.origin}/roster/${settings.restaurantToken}`;
  const bookingLink  = `${window.location.origin}/book/${settings.restaurantToken}`;
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
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(bookingLink); toast.success('Booking link copied!'); }}
                  className="btn-ghost flex items-center gap-1.5 text-sm">
                  <Link className="w-3.5 h-3.5" /> Booking link
                </button>
                <button onClick={() => setShowEventForm(true)} className="btn-primary flex items-center gap-2">
                  <Plus className="w-4 h-4" /> New event
                </button>
              </div>
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
            <button onClick={() => { setShowSettingsModal(true); setSettingsSection(tab === 'bookings' ? 'booking' : 'roster'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-muted transition-colors text-sm font-medium text-muted-foreground hover:text-foreground"
              title={tab === 'bookings' ? 'Booking rules & hours' : 'Shift templates'}>
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
              {/* Toggle and "Add" are sibling buttons (a button cannot contain a button). */}
              <div className="flex items-center hover:bg-muted/30 transition-colors">
              <button
                onClick={() => setShowPackagesPanel(v => !v)}
                aria-expanded={showPackagesPanel}
                className="flex-1 flex items-center justify-between pl-5 pr-2 py-3.5 text-left"
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
                {showPackagesPanel ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              <button
                onClick={() => { setEditingPackage(null); setShowPackageForm(true); }}
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline pr-5 pl-2 py-3.5">
                <Plus className="w-3 h-3" /> Add
              </button>
              </div>

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
        <Modal title="Calendar settings" wide onClose={() => setShowSettingsModal(false)}>
          {/* Section switcher */}
          <div className="flex gap-1 bg-muted/50 p-1 rounded-xl w-fit mb-5">
            {([['booking', 'Booking'], ['roster', 'Roster']] as const).map(([s, label]) => (
              <button key={s} onClick={() => setSettingsSection(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${settingsSection === s ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
                {label}
              </button>
            ))}
          </div>

          {settingsSection === 'booking' && (
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

          </div>
          )}

          {settingsSection === 'roster' && (
          <div className="space-y-4">
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
          )}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-foreground/30 backdrop-blur-sm" onClick={() => setRejectId(null)}>
          <div className="bg-card rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
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
