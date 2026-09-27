import { useState } from 'react';
import { toast } from 'sonner';
import type { CalendarEvent, CalendarEventType, EventPackage } from '@/domain/types';
import { today, TYPE_LABEL } from './shared';

// ─── Event form ───────────────────────────────────────────────────────────────

export default function EventForm({ initialDate, packages, onSave, onClose }: {
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
