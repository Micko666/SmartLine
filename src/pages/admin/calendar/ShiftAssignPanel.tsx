import { X, Edit2, Trash2 } from 'lucide-react';
import type { Employee, Shift, ShiftAssignment } from '@/domain/types';
import { initials, shiftHours } from './shared';

// ─── Shift assign panel (replaces modal click for quick staff assignment) ──────

export default function ShiftAssignPanel({ shift, employees, stations, onClose, onEditFull, onDelete, onUpdateAssignments }: {
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
