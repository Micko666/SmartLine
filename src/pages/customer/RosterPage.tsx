/**
 * RosterPage — public staff-facing weekly schedule.
 * Accessed via /roster/:restaurantToken — no login required.
 * Shows shift blocks with each person's name and their role in that shift.
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChefHat, AlertCircle } from 'lucide-react';
import { fetchRosterDataByToken } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { Employee, Shift } from '@/domain/types';

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }
function today()          { return isoDate(new Date()); }

function initials(name: string) {
  return name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function shiftHours(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm;
  let e = eh * 60 + em;
  if (e <= s) e += 1440;
  return Math.round((e - s) / 60 * 10) / 10;
}

function weekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface RosterData {
  businessName: string;
  employees: Employee[];
  shifts: Shift[];
}

export default function RosterPage() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [data, setData]             = useState<RosterData | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid roster link.'); setLoading(false); return; }
    (async () => {
      try {
        let result: RosterData | null = null;
        if (isSupabaseEnabled()) {
          const remote = await fetchRosterDataByToken(restaurantToken);
          if (remote) result = remote as RosterData;
        }
        if (!result) {
          const state = useStore.getState();
          if (state.settings?.restaurantToken === restaurantToken) {
            result = { businessName: state.settings.businessName, employees: state.employees, shifts: state.shifts };
          }
        }
        if (!result) { setError('Roster not found.'); return; }
        setData(result);
      } catch {
        setError('Failed to load roster.');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantToken]);

  const weekDays = useMemo(() => {
    const monday = weekMonday(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return isoDate(d);
    });
  }, [weekOffset]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of (data?.shifts ?? [])) {
      if (!map.has(shift.date)) map.set(shift.date, []);
      map.get(shift.date)!.push(shift);
    }
    return map;
  }, [data]);

  const employeeMap = useMemo(
    () => new Map((data?.employees ?? []).map(e => [e.id, e])),
    [data],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4 bg-background">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>
        <p className="font-semibold text-lg">{error || 'Roster unavailable'}</p>
      </div>
    );
  }

  const weekStart = new Date(weekDays[0] + 'T12:00:00');
  const weekEnd   = new Date(weekDays[6] + 'T12:00:00');
  const weekLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    + ' – '
    + weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <ChefHat className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-sm leading-tight truncate">{data.businessName}</p>
            <p className="text-[11px] text-muted-foreground">Staff Schedule</p>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Week navigation */}
        <div className="flex items-center justify-between">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="font-semibold text-sm">{weekLabel}</p>
            {weekOffset !== 0 && (
              <button onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline mt-0.5">Back to this week</button>
            )}
          </div>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Weekly grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {weekDays.map((dateStr, i) => {
            const dayShifts = shiftsByDate.get(dateStr) ?? [];
            const isToday   = dateStr === today();
            const isPast    = dateStr < today();

            return (
              <div key={dateStr}
                className={`rounded-2xl border p-3 space-y-2 transition-all ${
                  isToday
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : isPast
                      ? 'border-border/50 bg-muted/30 opacity-60'
                      : 'border-border bg-card'
                }`}>
                {/* Day header */}
                <div className="flex items-baseline justify-between">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {DAY_LABELS[i]}
                  </span>
                  <span className={`text-lg font-bold leading-none ${isToday ? 'text-primary' : 'text-foreground'}`}>
                    {new Date(dateStr + 'T12:00:00').getDate()}
                  </span>
                </div>

                {dayShifts.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60 italic pt-1">No shifts</p>
                ) : (
                  <div className="space-y-2.5">
                    {dayShifts.map(shift => {
                      const understaffed = shift.assignments.length < shift.minStaff;
                      const hours = shiftHours(shift.startTime, shift.endTime);

                      return (
                        <div key={shift.id}
                          className={`rounded-xl border overflow-hidden ${understaffed ? 'border-warning/50 bg-warning/5' : 'border-border bg-muted/30'}`}>
                          {/* Color stripe */}
                          <div className="h-1" style={{ backgroundColor: shift.color }} />

                          <div className="p-2.5 space-y-2">
                            {/* Shift name + time */}
                            <div>
                              <p className="font-semibold text-xs">{shift.name}</p>
                              <p className="text-muted-foreground font-mono text-[10px]">
                                {shift.startTime}–{shift.endTime}
                                <span className="ml-1 font-sans not-italic text-muted-foreground/70">({hours}h)</span>
                              </p>
                            </div>

                            {/* Assignments: each person + their role */}
                            {shift.assignments.length === 0 ? (
                              <p className="text-[10px] text-muted-foreground/60 italic">No one assigned</p>
                            ) : (
                              <div className="space-y-1.5">
                                {shift.assignments.map((a, idx) => {
                                  const emp = employeeMap.get(a.employeeId);
                                  if (!emp) return null;
                                  return (
                                    <div key={idx} className="flex items-start gap-2">
                                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 mt-0.5"
                                        style={{ backgroundColor: emp.color }}>
                                        {initials(emp.name)}
                                      </span>
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-semibold leading-tight">{emp.name}</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">{a.role}</p>
                                        {a.roleNote && (
                                          <p className="text-[9px] text-muted-foreground/70 italic leading-tight mt-0.5">{a.roleNote}</p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {understaffed && (
                              <p className="text-[10px] text-warning font-medium flex items-center gap-1">
                                ⚠ Need {shift.minStaff - shift.assignments.length} more
                              </p>
                            )}

                            {shift.notes && (
                              <p className="text-[10px] text-muted-foreground italic line-clamp-2">{shift.notes}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Team legend */}
        {data.employees.filter(e => e.active).length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Team</p>
            <div className="flex flex-wrap gap-3">
              {data.employees.filter(e => e.active).map(emp => (
                <div key={emp.id} className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                    style={{ backgroundColor: emp.color }}>
                    {initials(emp.name)}
                  </div>
                  <div>
                    <p className="text-xs font-semibold leading-none">{emp.name}</p>
                    {emp.role && <p className="text-[10px] text-muted-foreground mt-0.5">{emp.role}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
