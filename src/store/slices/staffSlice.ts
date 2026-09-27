/** Employees, shifts and the weekly shift template. */
import { toast } from 'sonner';
import type { Employee, Shift } from '../../domain/types';
import * as bridge from '../bridge';
import { genId, now, usesSupabasePersistence, persistLocal } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createStaffSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'addEmployee' | 'updateEmployee' | 'deleteEmployee' | 'addShift' | 'updateShift' | 'deleteShift' | 'applyWeekTemplate' | 'updateWeekTemplate'> => ({
  // ── Employees ────────────────────────────────────────────────────────────────
  addEmployee(data) {
    const emp: Employee = { ...data, id: genId(), createdAt: now() };
    set(s => ({ employees: [...s.employees, emp] }));
    persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewEmployee(emp, user.id).catch(() =>
        toast.error('Failed to save employee.'));
    }
    return emp;
  },

  updateEmployee(id, updates) {
    set(s => ({ employees: s.employees.map(e => e.id === id ? { ...e, ...updates } : e) }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistEmployeeUpdate(id, updates).catch(() =>
        toast.error('Failed to update employee.'));
    }
  },

  deleteEmployee(id) {
    // Remove employee from all shifts before deleting
    set(s => ({
      employees: s.employees.filter(e => e.id !== id),
      shifts: s.shifts.map(sh => ({
        ...sh,
        assignments: sh.assignments.filter(a => a.employeeId !== id),
      })),
    }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteEmployee(id).catch(() =>
        toast.error('Failed to delete employee.'));
    }
  },


  // ── Shifts ────────────────────────────────────────────────────────────────────
  addShift(data) {
    const shift: Shift = { ...data, id: genId(), createdAt: now() };
    set(s => ({ shifts: [...s.shifts, shift] }));
    persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewShift(shift, user.id).catch(() =>
        toast.error('Failed to save shift.'));
    }
    return shift;
  },

  updateShift(id, updates) {
    set(s => ({ shifts: s.shifts.map(sh => sh.id === id ? { ...sh, ...updates } : sh) }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistShiftUpdate(id, updates).catch(() =>
        toast.error('Failed to update shift.'));
    }
  },

  deleteShift(id) {
    set(s => ({ shifts: s.shifts.filter(sh => sh.id !== id) }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteShift(id).catch(() =>
        toast.error('Failed to delete shift.'));
    }
  },

  applyWeekTemplate(mondayIsoDate) {
    const { calendarSettings, shifts } = get();
    const template = calendarSettings.weekTemplate ?? [];
    if (!template.length) { toast.info('Define a default week template first.'); return; }

    // Build target date for each day-of-week in the week starting on mondayIsoDate
    const monday = new Date(mondayIsoDate + 'T12:00:00');
    const toCreate: Omit<Shift, 'id' | 'createdAt'>[] = [];

    for (const dayTpl of template) {
      // JS dayOfWeek: 1=Mon…6=Sat, 0=Sun. Map to offset from Monday (0–6).
      const offset = dayTpl.dayOfWeek === 0 ? 6 : dayTpl.dayOfWeek - 1;
      const d = new Date(monday);
      d.setDate(monday.getDate() + offset);
      const dateStr = d.toISOString().slice(0, 10);

      for (const slot of dayTpl.slots) {
        const exists = shifts.some(s => s.date === dateStr && s.name === slot.name);
        if (!exists) {
          toCreate.push({
            date: dateStr, name: slot.name,
            startTime: slot.startTime, endTime: slot.endTime,
            color: slot.color, minStaff: slot.minStaff,
            stationId: slot.stationId, assignments: [], notes: '',
          });
        }
      }
    }

    if (!toCreate.length) { toast.info('All template shifts already exist for this week.'); return; }

    const newShifts: Shift[] = toCreate.map(s => ({ ...s, id: genId(), createdAt: now() }));
    set(s => ({ shifts: [...s.shifts, ...newShifts] }));
    persistLocal(get);

    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      for (const shift of newShifts) {
        bridge.persistNewShift(shift, user.id).catch(() =>
          toast.error('Failed to save shift.'));
      }
    }
    toast.success(`${newShifts.length} shift${newShifts.length !== 1 ? 's' : ''} created from template`);
  },

  updateWeekTemplate(template) {
    const updates = { weekTemplate: template };
    set(s => ({ calendarSettings: { ...s.calendarSettings, ...updates } }));
    persistLocal(get);
    const { calendarSettings, user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistCalendarSettings(calendarSettings, user.id).catch(() =>
        toast.error('Failed to save week template.'));
    }
  },
});
