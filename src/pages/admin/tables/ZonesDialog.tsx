import { useState } from 'react';
import { Trash2, Pencil } from 'lucide-react';
import { ZONE_PALETTE } from '@/domain/tables';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

// ─── ZonesDialog ──────────────────────────────────────────────────────────────

export default function ZonesDialog({ open, onOpenChange, zones, zoneColors, tableCounts, onRename, onDelete }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  zones: string[]; zoneColors: Record<string, typeof ZONE_PALETTE[0]>;
  tableCounts: Record<string, number>;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState<{ orig: string; val: string } | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Manage Zones</DialogTitle></DialogHeader>
        {zones.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No zones yet. Add a zone when creating or editing a table.</p>
        ) : (
          <div className="space-y-2 py-1">
            {zones.map(zone => {
              const zc = zoneColors[zone];
              const count = tableCounts[zone] ?? 0;
              const isEditing = editing?.orig === zone;
              return (
                <div key={zone} className="flex items-center gap-3 p-2 rounded-xl border border-border bg-background">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zc.text }} />
                  {isEditing ? (
                    <input
                      autoFocus value={editing!.val}
                      onChange={e => setEditing(ed => ed ? { ...ed, val: e.target.value } : null)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && editing!.val.trim()) { onRename(zone, editing!.val.trim()); setEditing(null); }
                        if (e.key === 'Escape') setEditing(null);
                      }}
                      className="flex-1 h-7 px-2 rounded-lg border border-primary bg-background text-sm focus:outline-none"
                    />
                  ) : (
                    <span className="flex-1 text-sm font-medium text-foreground">{zone}</span>
                  )}
                  <span className="text-[11px] text-muted-foreground">{count} table{count !== 1 ? 's' : ''}</span>
                  {isEditing ? (
                    <button onClick={() => { if (editing!.val.trim()) { onRename(zone, editing!.val.trim()); setEditing(null); } }}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-primary">
                      <span className="text-xs font-bold">✓</span>
                    </button>
                  ) : (
                    <button onClick={() => setEditing({ orig: zone, val: zone })}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted text-muted-foreground">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <button onClick={() => onDelete(zone)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 text-destructive/70 hover:text-destructive">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
