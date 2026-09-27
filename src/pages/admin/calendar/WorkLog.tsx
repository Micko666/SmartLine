import { useState, useMemo } from 'react';
import { History } from 'lucide-react';
import type { Employee, Shift, ShiftAssignment } from '@/domain/types';
import { isoDate, today, initials, shiftHours } from './shared';

// ─── Work Log ─────────────────────────────────────────────────────────────────

export default function WorkLog({ shifts, employees }: { shifts: Shift[]; employees: Employee[] }) {
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
