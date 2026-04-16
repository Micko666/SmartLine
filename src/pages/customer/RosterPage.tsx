/**
 * RosterPage — public staff-facing weekly schedule.
 * Accessed via /roster/:restaurantToken
 * No login required — manager shares a link.
 */
import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChefHat, Users } from 'lucide-react';
import { fetchRosterDataByToken } from '@/lib/supabase/queries/public';
import { useStore } from '@/store';
import { isSupabaseEnabled } from '@/store/flags';
import type { Employee, Shift } from '@/domain/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function today() {
  return isoDate(new Date());
}

/** Get Monday of the ISO week containing `d`. */
function weekMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Component ────────────────────────────────────────────────────────────────

interface RosterData {
  businessName: string;
  employees: Employee[];
  shifts: Shift[];
}

export default function RosterPage() {
  const { restaurantToken } = useParams<{ restaurantToken: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [data, setData]       = useState<RosterData | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restaurantToken) { setError('Invalid roster link.'); setLoading(false); return; }

    (async () => {
      try {
        let result: RosterData | null = null;

        if (isSupabaseEnabled()) {
          const remote = await fetchRosterDataByToken(restaurantToken);
          if (remote) result = remote;
        }

        // Local fallback
        if (!result) {
          const state = useStore.getState();
          if (state.settings?.restaurantToken === restaurantToken) {
            result = {
              businessName: state.settings.businessName,
              employees:    state.employees,
              shifts:       state.shifts,
            };
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

  // ── Week days ─────────────────────────────────────────────────────────────────

  const weekDays = useMemo(() => {
    const monday = weekMonday(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return isoDate(d);
    });
  }, [weekOffset]);

  const todayStr = today();

  // ── Derived data ──────────────────────────────────────────────────────────────

  const shiftsByDate = useMemo(() => {
    if (!data) return new Map<string, Shift[]>();
    const map = new Map<string, Shift[]>();
    for (const shift of data.shifts) {
      if (!map.has(shift.date)) map.set(shift.date, []);
      map.get(shift.date)!.push(shift);
    }
    return map;
  }, [data]);

  const employeeMap = useMemo(() => {
    const map = new Map<string, Employee>();
    for (const emp of (data?.employees ?? [])) map.set(emp.id, emp);
    return map;
  }, [data]);

  // ── Loading / error states ────────────────────────────────────────────────────

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
          <span className="text-3xl">⚠️</span>
        </div>
        <p className="text-foreground font-semibold text-lg">{error || 'Roster unavailable'}</p>
      </div>
    );
  }

  // ── Week label ────────────────────────────────────────────────────────────────

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
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-2 rounded-xl hover:bg-muted transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="font-semibold text-sm">{weekLabel}</p>
            {weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-xs text-primary hover:underline mt-0.5"
              >
                Back to this week
              </button>
            )}
          </div>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-2 rounded-xl hover:bg-muted transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Weekly grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
          {weekDays.map((dateStr, i) => {
            const dayShifts = shiftsByDate.get(dateStr) ?? [];
            const isToday   = dateStr === todayStr;
            const isPast    = dateStr < todayStr;
            const dayDate   = new Date(dateStr + 'T12:00:00');
            const dayNum    = dayDate.getDate();
            const monthAbbr = dayDate.toLocaleDateString('en-US', { month: 'short' });

            return (
              <div
                key={dateStr}
                className={`rounded-2xl border p-3 space-y-2 transition-all ${
                  isToday
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : isPast
                      ? 'border-border/50 bg-muted/30 opacity-60'
                      : 'border-border bg-card'
                }`}
              >
                {/* Day header */}
                <div className="flex items-baseline justify-between">
                  <span className={`text-xs font-semibold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                    {DAY_LABELS[i]}
                  </span>
                  <span className={`text-lg font-bold leading-none ${isToday ? 'text-primary' : 'text-foreground'}`}>
                    {dayNum}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground -mt-1">{monthAbbr}</p>

                {/* Shifts */}
                {dayShifts.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/60 italic pt-1">No shifts</p>
                ) : (
                  <div className="space-y-2">
                    {dayShifts.map(shift => {
                      const assignedEmployees = shift.employeeIds
                        .map(id => employeeMap.get(id))
                        .filter(Boolean) as Employee[];
                      const understaffed = assignedEmployees.length < shift.minStaff;

                      return (
                        <div
                          key={shift.id}
                          className={`rounded-xl p-2.5 border text-xs ${
                            understaffed
                              ? 'border-warning/50 bg-warning/5'
                              : 'border-border bg-muted/40'
                          }`}
                        >
                          {/* Shift role + time */}
                          <p className="font-semibold truncate">{shift.role || 'Shift'}</p>
                          <p className="text-muted-foreground font-mono text-[10px]">
                            {shift.startTime} – {shift.endTime}
                          </p>

                          {/* Employee pills */}
                          {assignedEmployees.length > 0 ? (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {assignedEmployees.map(emp => (
                                <span
                                  key={emp.id}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white"
                                  style={{ backgroundColor: emp.color }}
                                >
                                  {emp.name.split(' ')[0]}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[10px] text-muted-foreground/60 mt-1 italic">No one assigned</p>
                          )}

                          {/* Understaffing warning */}
                          {understaffed && (
                            <p className="text-[10px] text-warning font-medium mt-1 flex items-center gap-0.5">
                              <Users className="w-2.5 h-2.5" />
                              Need {shift.minStaff - assignedEmployees.length} more
                            </p>
                          )}

                          {/* Notes */}
                          {shift.notes && (
                            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2 italic">
                              {shift.notes}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        {data.employees.length > 0 && (
          <div className="glass-card p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Staff</p>
            <div className="flex flex-wrap gap-2">
              {data.employees.map(emp => (
                <div key={emp.id} className="flex items-center gap-1.5 text-sm">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: emp.color }}
                  />
                  <span className="font-medium">{emp.name}</span>
                  {emp.role && <span className="text-muted-foreground text-xs">· {emp.role}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
