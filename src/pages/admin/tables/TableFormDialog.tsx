import { useEffect, useState } from 'react';
import type { Table } from '@/domain/types';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SHAPE_OPTIONS, CAPACITY_PRESETS, TableFormData } from './shared';
import TableShapeSvg from './TableShapeSvg';

export default function TableFormDialog({ open, onOpenChange, table, existingZones, existingFloors, defaultFloor, defaultName, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  table: Table | null; existingZones: string[]; existingFloors: string[]; defaultFloor?: string; defaultName?: string;
  onSave: (data: TableFormData) => void;
}) {
  const [form, setForm] = useState<TableFormData>({ name: '', capacity: 4, shape: 'square', zone: '', floor: '' });
  const [newZone, setNewZone] = useState(''); const [creatingZone, setCreatingZone] = useState(false);
  const [newFloor, setNewFloor] = useState(''); const [creatingFloor, setCreatingFloor] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ name: table?.name ?? defaultName ?? '', capacity: table?.capacity ?? 4, shape: table?.shape ?? 'square', zone: table?.zone ?? '', floor: table?.floor ?? defaultFloor ?? '' });
      setNewZone(''); setCreatingZone(false); setNewFloor(''); setCreatingFloor(false);
    }
  }, [open, table, defaultFloor, defaultName]);

  function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    onSave({
      ...form,
      name:  form.name.trim(),
      zone:  creatingZone  ? newZone.trim()  : form.zone,
      floor: creatingFloor ? newFloor.trim() : form.floor,
    });
  }

  const allZones  = [...new Set([...existingZones,  ...(table?.zone  ? [table.zone]  : [])])];
  const allFloors = [...new Set([...existingFloors, ...(table?.floor ? [table.floor] : [])])];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{table ? 'Edit table' : 'Add table'}</DialogTitle>
          <DialogDescription>Name, seats, zone and floor of the table.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-1">

          {/* Name */}
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input placeholder="e.g. Table 5, Window Seat, Bar Counter" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
          </div>

          {/* Shape — fixed-height preview containers so labels align */}
          <div className="space-y-1.5">
            <Label>Shape</Label>
            <div className="grid grid-cols-4 gap-2">
              {SHAPE_OPTIONS.map(opt => {
                const isActive = form.shape === opt.value;
                // Each preview reflects the actual shape proportions
                const [pw, ph] = opt.value === 'bar'     ? [44, 14]
                               : opt.value === 'square'  ? [40, 26]  // landscape rectangle
                               : opt.value === 'l-shape' ? [30, 30]
                               :                           [26, 26];  // round → circle
                return (
                  <button key={opt.value} type="button" onClick={() => setForm(f => ({ ...f, shape: opt.value }))}
                    className={`flex flex-col items-center gap-1.5 py-2.5 rounded-xl border text-[11px] font-medium transition-all ${
                      isActive ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-muted-foreground'
                    }`}
                  >
                    {/* Fixed-height container so all labels land at same vertical position */}
                    <div className="flex items-center justify-center" style={{ width: 44, height: 34 }}>
                      <div className="relative" style={{ width: pw, height: ph }}>
                        <TableShapeSvg shape={opt.value} w={pw} h={ph}
                          fill={isActive ? 'rgba(13,148,136,0.12)' : 'rgba(100,116,139,0.08)'}
                          stroke={isActive ? '#0d9488' : '#94a3b8'}
                        />
                      </div>
                    </div>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Seats */}
          <div className="space-y-1.5">
            <Label>Seats</Label>
            <div className="flex flex-wrap gap-2">
              {CAPACITY_PRESETS.map(n => (
                <button key={n} type="button" onClick={() => setForm(f => ({ ...f, capacity: n }))}
                  className={`w-10 h-10 rounded-xl text-sm font-semibold border transition-all ${
                    form.capacity === n ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-muted-foreground'
                  }`}
                >{n}</button>
              ))}
            </div>
          </div>

          {/* Floor */}
          <div className="space-y-1.5">
            <Label>Floor <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            {!creatingFloor ? (
              <div className="flex gap-2">
                <select value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))}
                  className="flex-1 h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">No floor</option>
                  {allFloors.map(fl => <option key={fl} value={fl}>{fl}</option>)}
                </select>
                <button type="button" onClick={() => setCreatingFloor(true)}
                  className="px-3 h-10 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors whitespace-nowrap"
                >+ New</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="Floor name (e.g. Terrace)" value={newFloor} onChange={e => setNewFloor(e.target.value)} autoFocus />
                <button type="button" onClick={() => setCreatingFloor(false)}
                  className="px-3 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted"
                >Back</button>
              </div>
            )}
          </div>

          {/* Zone */}
          <div className="space-y-1.5">
            <Label>Zone <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
            {!creatingZone ? (
              <div className="flex gap-2">
                <select value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))}
                  className="flex-1 h-10 px-3 rounded-xl border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">No zone</option>
                  {allZones.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                <button type="button" onClick={() => setCreatingZone(true)}
                  className="px-3 h-10 rounded-xl border border-dashed border-border text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors whitespace-nowrap"
                >+ New</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input placeholder="Zone name (e.g. Terrace)" value={newZone} onChange={e => setNewZone(e.target.value)} autoFocus />
                <button type="button" onClick={() => setCreatingZone(false)}
                  className="px-3 h-10 rounded-xl border border-border text-sm text-muted-foreground hover:bg-muted"
                >Back</button>
              </div>
            )}
          </div>

        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>{table ? 'Save changes' : 'Add table'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
