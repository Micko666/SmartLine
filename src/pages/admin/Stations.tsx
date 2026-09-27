import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Monitor, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { buildStation } from '@/domain/stations';
import type { Station } from '@/domain/types';
import { FormState, defaultForm, stationToForm } from './stations/shared';
import StationForm from './stations/StationForm';
import StationCard from './stations/StationCard';

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Stations() {
  const { settings, stations, menuItems, addStation, updateStation, deleteStation } = useStore(useShallow(s => ({
    settings: s.settings,
    stations: s.stations,
    menuItems: s.menuItems,
    addStation: s.addStation,
    updateStation: s.updateStation,
    deleteStation: s.deleteStation,
  })));

  const restaurantToken = settings.restaurantToken;

  // Deduplicated category list from active menu items
  const availableCategories = Array.from(
    new Set(menuItems.filter(m => m.status === 'active').map(m => m.category))
  ).sort();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Station | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [showPin, setShowPin] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Station | null>(null);

  function openCreate() {
    setEditTarget(null);
    setForm(defaultForm());
    setShowPin(false);
    setDialogOpen(true);
  }

  function openEdit(station: Station) {
    setEditTarget(station);
    setForm(stationToForm(station));
    setShowPin(false);
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) { toast.error('Station name is required'); return; }
    if (form.pin && (form.pin.length < 4 || form.pin.length > 6)) {
      toast.error('PIN must be 4–6 digits'); return;
    }

    const permissions = {
      canAdvanceOrders: form.canAdvanceOrders,
      canCancelOrders: form.canCancelOrders,
      canLogKitchenEvents: form.canLogKitchenEvents,
      canAdjustPrepTime: form.canAdjustPrepTime,
      canReworkOrders: form.canReworkOrders,
      showProductionSummary: form.showProductionSummary,
      mapAccess: form.mapAccess,
      canUpdateTableStatus: form.canUpdateTableStatus,
      canEditTableLayout: form.canEditTableLayout,
      categoryMode: form.categoryMode,
      filterCategories: form.filterCategories,
      visibleStatuses: form.visibleStatuses,
    };

    if (editTarget) {
      const ok = await updateStation(editTarget.id, { name, role: form.role, pin: form.pin || undefined, removePin: form.removePin, color: form.color, permissions });
      if (ok) toast.success('Station updated');
      else return;
    } else {
      const station = buildStation({ name, role: form.role, pin: form.pin, color: form.color, permissions });
      if (await addStation(station)) toast.success('Station created');
      else return;
    }
    setDialogOpen(false);
  }

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Station Profiles</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Create PIN-protected screens for kitchen, service, and bar workstations
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            Add Station
          </Button>
        </div>

        {/* Empty state */}
        {stations.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
              <Monitor className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No stations yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add a kitchen, bar, or service station to give staff a focused view
              </p>
            </div>
            <Button variant="outline" onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" /> Add your first station
            </Button>
          </div>
        )}

        {/* Station grid */}
        <AnimatePresence mode="popLayout">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {stations.map(station => (
              <StationCard
                key={station.id}
                station={station}
                restaurantToken={restaurantToken}
                onEdit={() => openEdit(station)}
                onDelete={() => setDeleteTarget(station)}
              />
            ))}
          </div>
        </AnimatePresence>

        {/* How-to note */}
        {stations.length > 0 && (
          <div className="bg-muted/50 rounded-2xl p-4 text-sm text-muted-foreground">
            <strong className="text-foreground">How station screens work:</strong> Each station has a unique URL — open it on any tablet or monitor. Staff enter the PIN once and stay unlocked for 12 hours. No user accounts needed.
          </div>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? 'Edit Station' : 'New Station'}</DialogTitle>
          </DialogHeader>
          <StationForm
            form={form}
            onChange={setForm}
            showPin={showPin}
            onTogglePin={() => setShowPin(p => !p)}
            availableCategories={availableCategories}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editTarget ? 'Save changes' : 'Create station'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete station?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be removed. Any devices using this station URL will lose access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteStation(deleteTarget.id);
                  toast.success('Station deleted');
                  setDeleteTarget(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
