/** Shared constants/helpers extracted from KitchenStation.tsx (behavior-preserving split). */
import { type KitchenEventType } from '@/lib/supabase/realtime/useStationOrders';
import { ORDER_STATUS_COLORS } from '@/domain/orderMachine';
import type { Station, OrderStatus } from '@/domain/types';


export interface Props {
  station: Station;
  restaurantName: string;
  onLock: () => void;
}

export const STATUS_BG: Record<string, string> = {
  paid:      'bg-yellow-500/8 border-yellow-500/25',
  preparing: 'bg-orange-500/8 border-orange-500/25',
  ready:     'bg-green-500/8 border-green-500/25',
};

export const COLUMN_LABELS: Record<string, { label: string; color: string }> = {
  paid:      { label: 'New',         color: ORDER_STATUS_COLORS.paid },
  preparing: { label: 'In Progress', color: ORDER_STATUS_COLORS.preparing },
  ready:     { label: 'Ready',       color: ORDER_STATUS_COLORS.ready },
};

export const ALL_STATUSES: OrderStatus[] = ['paid', 'preparing', 'ready'];

// ─── LogEventPanel ────────────────────────────────────────────────────────────

export const LOG_TYPES: { value: KitchenEventType; label: string }[] = [
  { value: 'note',   label: 'Note'   },
  { value: 'delay',  label: 'Delay'  },
  { value: 'remake', label: 'Rework' },
];
