/** Shared constants/helpers extracted from Stations.tsx (behavior-preserving split). */
import { ChefHat, Waves, UtensilsCrossed, Sliders } from 'lucide-react';
import { normalizeStation, ROLE_PRESETS } from '@/domain/stations';
import type { Station, StationRole, OrderStatus } from '@/domain/types';


export const ROLE_ICONS: Record<StationRole, React.ElementType> = {
  kitchen: ChefHat,
  service: UtensilsCrossed,
  bar: Waves,
  custom: Sliders,
};

export const ROLE_DESCRIPTIONS: Record<StationRole, string> = {
  kitchen: 'Full cooking workflow — track orders, log events, adjust prep times',
  service: 'Floor staff — deliver orders, track tables, advance status',
  bar:     'Drinks only — filter to specific categories, track pour queue',
  custom:  'Custom permissions — configure exactly what this station can do',
};

export const ALL_STATUSES: OrderStatus[] = ['placed', 'preparing', 'ready', 'completed', 'cancelled'];

// ─── Station Form ─────────────────────────────────────────────────────────────

export interface FormState {
  name: string;
  role: StationRole;
  /** New PIN to set. Blank keeps the current PIN (PINs are never read back). */
  pin: string;
  /** Editing a PIN-protected station: remove its PIN on save. */
  removePin: boolean;
  /** Whether the station being edited currently has a PIN. */
  hasPin: boolean;
  color: string;
  canAdvanceOrders: boolean;
  canCancelOrders: boolean;
  canLogKitchenEvents: boolean;
  canAdjustPrepTime: boolean;
  canReworkOrders: boolean;
  showProductionSummary: boolean;
  mapAccess: boolean;
  canUpdateTableStatus: boolean;
  canRecordPayments: boolean;
  canEditTableLayout: boolean;
  categoryMode: 'all' | 'focus' | 'exclusive';
  filterCategories: string[];
  visibleStatuses: OrderStatus[];
}

export function defaultForm(role: StationRole = 'kitchen'): FormState {
  const preset = ROLE_PRESETS[role];
  return {
    name: '',
    role,
    pin: '',
    removePin: false,
    hasPin: false,
    color: preset.color,
    canAdvanceOrders: preset.permissions.canAdvanceOrders,
    canCancelOrders: preset.permissions.canCancelOrders,
    canLogKitchenEvents: preset.permissions.canLogKitchenEvents,
    canAdjustPrepTime: preset.permissions.canAdjustPrepTime,
    canReworkOrders: preset.permissions.canReworkOrders,
    showProductionSummary: preset.permissions.showProductionSummary,
    mapAccess: preset.permissions.mapAccess,
    canUpdateTableStatus: preset.permissions.canUpdateTableStatus,
    canRecordPayments: preset.permissions.canRecordPayments,
    canEditTableLayout: preset.permissions.canEditTableLayout,
    categoryMode: preset.permissions.categoryMode,
    filterCategories: [...preset.permissions.filterCategories],
    visibleStatuses: [...preset.permissions.visibleStatuses],
  };
}

export function stationToForm(s: Station): FormState {
  const { permissions: p } = normalizeStation(s);
  return {
    name: s.name,
    role: s.role,
    pin: '',
    removePin: false,
    hasPin: s.hasPin ?? !!s.pin,
    color: s.color,
    canAdvanceOrders:      p.canAdvanceOrders,
    canCancelOrders:       p.canCancelOrders,
    canLogKitchenEvents:   p.canLogKitchenEvents,
    canAdjustPrepTime:     p.canAdjustPrepTime,
    canReworkOrders:       p.canReworkOrders,
    showProductionSummary: p.showProductionSummary,
    mapAccess:             p.mapAccess ?? false,
    canUpdateTableStatus:  p.canUpdateTableStatus ?? false,
    canRecordPayments:     p.canRecordPayments ?? false,
    canEditTableLayout:    p.canEditTableLayout ?? false,
    categoryMode:          p.categoryMode ?? 'all',
    filterCategories:      [...p.filterCategories],
    visibleStatuses:       [...p.visibleStatuses],
  };
}
