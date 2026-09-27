import { useState } from 'react';
import { toast } from 'sonner';
import type { EventPackage } from '@/domain/types';

// ─── Package form ─────────────────────────────────────────────────────────────

export default function PackageForm({ initial, sym, onSave, onClose }: {
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
