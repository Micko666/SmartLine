import { useState } from 'react';
import { Phone, Mail } from 'lucide-react';
import type { Employee } from '@/domain/types';
import { initials, PRESET_COLORS } from './shared';

// ─── Employee form ─────────────────────────────────────────────────────────────

export default function EmployeeForm({ initial, onSave, onClose }: {
  initial?: Employee;
  onSave: (data: Omit<Employee, 'id' | 'createdAt'>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '', role: initial?.role ?? '',
    phone: initial?.phone ?? '', email: initial?.email ?? '',
    color: initial?.color ?? PRESET_COLORS[0], active: initial?.active ?? true,
  });

  return (
    <form onSubmit={e => {
      e.preventDefault();
      if (!form.name.trim()) return;
      onSave({ name: form.name.trim(), role: form.role.trim(), phone: form.phone.trim() || undefined, email: form.email.trim() || undefined, color: form.color, active: form.active });
    }} className="space-y-4">
      <div className="flex justify-center">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold text-white shadow-sm" style={{ backgroundColor: form.color }}>
          {form.name ? initials(form.name) : '?'}
        </div>
      </div>
      <div>
        <label className="form-label">Name *</label>
        <input type="text" required value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input-field w-full" placeholder="Full name" />
      </div>
      <div>
        <label className="form-label">Default role / position</label>
        <input type="text" value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} className="input-field w-full" placeholder="Chef, Server, Bartender…" />
        <p className="text-[10px] text-muted-foreground mt-1">General label — set specific roles per shift.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label"><Phone className="w-3 h-3 inline mr-0.5" /> Phone</label>
          <input type="tel" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className="input-field w-full" placeholder="+1 234…" />
        </div>
        <div>
          <label className="form-label"><Mail className="w-3 h-3 inline mr-0.5" /> Email</label>
          <input type="email" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} className="input-field w-full" placeholder="staff@…" />
        </div>
      </div>
      <div>
        <label className="form-label">Color</label>
        <div className="flex gap-2 flex-wrap">
          {PRESET_COLORS.map(c => (
            <button key={c} type="button" onClick={() => setForm(f => ({...f, color: c}))}
              className={`w-8 h-8 rounded-xl border-2 transition-all ${form.color === c ? 'border-foreground scale-110 shadow-md' : 'border-transparent hover:scale-105'}`}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({...f, active: e.target.checked}))} className="w-4 h-4 rounded" />
        <span className="text-sm font-medium">Active (show in roster)</span>
      </label>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} className="btn-ghost px-4">Cancel</button>
        <button type="submit" className="btn-primary flex-1">Save employee</button>
      </div>
    </form>
  );
}
