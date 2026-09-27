/** Calendar events, event packages and booking policy settings. */
import { toast } from 'sonner';
import type { CalendarEvent, CalendarEventStatus, EventPackage } from '../../domain/types';
import { WORKSPACE_KEY } from '../workspace';
import * as bridge from '../bridge';
import { genId, now, activeUserId, usesSupabasePersistence, persistLocal } from '../runtime';
import type { StoreGet, StoreSet } from '../runtime';
import type { AppState } from '../types';

export const createCalendarSlice = (set: StoreSet, get: StoreGet): Pick<AppState, 'addCalendarEvent' | 'updateCalendarEvent' | 'deleteCalendarEvent' | 'approveCalendarEvent' | 'rejectCalendarEvent' | 'addEventPackage' | 'updateEventPackage' | 'deleteEventPackage' | 'updateCalendarSettings'> => ({
  // ── Calendar ─────────────────────────────────────────────────────────────────
  addCalendarEvent(data) {
    const event: CalendarEvent = { ...data, id: genId(), createdAt: now(), updatedAt: now() };
    set(s => ({ calendarEvents: [event, ...s.calendarEvents] }));
    const localUserId = activeUserId();
    if (!get()._hasHydrated && localUserId && !usesSupabasePersistence()) {
      // Public-page path (booking tab): store isn't hydrated so _persistLocal would
      // overwrite the admin's full workspace with empty arrays. Do a surgical
      // read-modify-write instead — only splice the new event into calendarEvents.
      try {
        const raw = localStorage.getItem(WORKSPACE_KEY(localUserId));
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.state) {
            parsed.state.calendarEvents = [event, ...(parsed.state.calendarEvents ?? [])];
            localStorage.setItem(WORKSPACE_KEY(localUserId), JSON.stringify(parsed));
          }
        }
      } catch { /* ignore */ }
    } else {
      persistLocal(get);
    }
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewCalendarEvent(event, user.id).catch(() =>
        toast.error('Failed to save event.'));
    }
    return event;
  },

  updateCalendarEvent(id, updates) {
    set(s => ({
      calendarEvents: s.calendarEvents.map(e =>
        e.id === id ? { ...e, ...updates, updatedAt: now() } : e),
    }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistCalendarEventUpdate(id, updates).catch(() =>
        toast.error('Failed to update event.'));
    }
  },

  deleteCalendarEvent(id) {
    set(s => ({ calendarEvents: s.calendarEvents.filter(e => e.id !== id) }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteCalendarEvent(id).catch(() =>
        toast.error('Failed to delete event.'));
    }
  },

  approveCalendarEvent(id, approvedBy) {
    const approvedAt = now();
    set(s => ({
      calendarEvents: s.calendarEvents.map(e =>
        e.id === id
          ? { ...e, status: 'approved' as CalendarEventStatus, approvedBy, approvedAt, updatedAt: now() }
          : e),
    }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistCalendarEventUpdate(id, { status: 'approved', approvedBy, approvedAt }).catch(() =>
        toast.error('Failed to approve event.'));
    }
  },

  rejectCalendarEvent(id, reason) {
    set(s => ({
      calendarEvents: s.calendarEvents.map(e =>
        e.id === id
          ? { ...e, status: 'rejected' as CalendarEventStatus, rejectionReason: reason ?? '', updatedAt: now() }
          : e),
    }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistCalendarEventUpdate(id, { status: 'rejected', rejectionReason: reason ?? '' }).catch(() =>
        toast.error('Failed to reject event.'));
    }
  },

  addEventPackage(data) {
    const pkg: EventPackage = { ...data, id: genId(), createdAt: now() };
    set(s => ({ eventPackages: [...s.eventPackages, pkg] }));
    persistLocal(get);
    const { user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistNewEventPackage(pkg, user.id).catch(() =>
        toast.error('Failed to save package.'));
    }
    return pkg;
  },

  updateEventPackage(id, updates) {
    set(s => ({
      eventPackages: s.eventPackages.map(p => p.id === id ? { ...p, ...updates } : p),
    }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistEventPackageUpdate(id, updates).catch(() =>
        toast.error('Failed to update package.'));
    }
  },

  deleteEventPackage(id) {
    set(s => ({ eventPackages: s.eventPackages.filter(p => p.id !== id) }));
    persistLocal(get);
    if (usesSupabasePersistence()) {
      bridge.persistDeleteEventPackage(id).catch(() =>
        toast.error('Failed to delete package.'));
    }
  },

  updateCalendarSettings(updates) {
    set(s => ({ calendarSettings: { ...s.calendarSettings, ...updates } }));
    persistLocal(get);
    const { calendarSettings, user } = get();
    if (usesSupabasePersistence() && user?.id) {
      bridge.persistCalendarSettings(calendarSettings, user.id).catch(() =>
        toast.error('Failed to save calendar settings.'));
    }
  },
});
