import { useState } from 'react';
import { Pencil, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// ─── FloorSelector ────────────────────────────────────────────────────────────

export default function FloorSelector({ floors, active, tableCounts, onSelect, onRename, onDelete }: {
  floors: string[];
  active: string | null;
  tableCounts: Record<string, number>;
  onSelect: (floor: string | null) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [renameVal, setRenameVal] = useState('');

  if (floors.length === 0) return null;

  function openEdit() {
    if (!active) return;
    setRenameVal(active);
    setEditOpen(true);
  }

  function commitRename() {
    const name = renameVal.trim();
    if (name && name !== active) onRename(active!, name);
    setEditOpen(false);
  }

  function commitDelete() {
    onDelete(active!);
    setEditOpen(false);
  }

  return (
    <>
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="relative">
          <select
            value={active ?? ''}
            onChange={e => onSelect(e.target.value || null)}
            className="h-8 pl-3 pr-8 rounded-xl border border-input bg-background text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring/20 text-foreground"
          >
            {floors.length > 1 && <option value="">All floors</option>}
            {floors.map(f => (
              <option key={f} value={f}>
                {f} ({tableCounts[f] ?? 0})
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {active && (
          <button
            onClick={openEdit}
            className="w-8 h-8 rounded-xl border border-border flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
            title="Edit floor"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Edit floor</DialogTitle>
            <DialogDescription>Rename this floor or remove it.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Floor name</Label>
              <Input
                value={renameVal}
                onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commitRename(); }}
                autoFocus
              />
            </div>
            <Button onClick={commitRename} className="w-full">Save name</Button>
            <Button
              variant="destructive"
              className="w-full"
              onClick={commitDelete}
            >
              Delete this floor
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
