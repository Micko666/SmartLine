/** Shared constants/helpers extracted from Menu.tsx (behavior-preserving split). */
import { ChefHat, Banknote, Package, Bike } from 'lucide-react';
import type { PaymentMethod } from '@/domain/types';


// ─── Unique stock-reservation session ID (per page load, intentionally fresh) ─
export const SESSION_ID = `session-${Math.random().toString(36).slice(2)}`;

// ─── Order modes ──────────────────────────────────────────────────────────────
export type OrderMode = 'dine-in' | 'takeaway' | 'delivery';

export const MODE_META: Record<OrderMode, { label: string; icon: React.ElementType; subtitle: string; tableId: string }> = {
  'dine-in':  { label: 'Dine In',  icon: ChefHat,  subtitle: '',          tableId: '' },
  takeaway:   { label: 'Takeaway', icon: Package,   subtitle: '🥡 Takeaway — collect from counter', tableId: 'takeaway' },
  delivery:   { label: 'Delivery', icon: Bike,      subtitle: '🛵 Delivery — we bring it to you',   tableId: 'delivery' },
};

// ─── Dietary & allergen display maps ─────────────────────────────────────────
export const DIETARY_EMOJI: Record<string, string> = {
  vegetarian:  '🥗',
  vegan:       '🌱',
  'gluten-free':'🌾',
  'dairy-free': '🥛',
  halal:       '☪️',
  kosher:      '✡️',
  spicy:       '🌶️',
};

export const DIETARY_STYLE: Record<string, string> = {
  vegetarian:   'bg-green-500/10 text-green-700 border-green-200',
  vegan:        'bg-emerald-500/10 text-emerald-700 border-emerald-200',
  'gluten-free':'bg-amber-500/10 text-amber-700 border-amber-200',
  'dairy-free': 'bg-blue-500/10 text-blue-700 border-blue-200',
  halal:        'bg-teal-500/10 text-teal-700 border-teal-200',
  kosher:       'bg-purple-500/10 text-purple-700 border-purple-200',
  spicy:        'bg-red-500/10 text-red-700 border-red-200',
};

// ─── Scheduling helpers ───────────────────────────────────────────────────────

export const ALLERGEN_EMOJI: Record<string, string> = {
  gluten:    '🌾',
  dairy:     '🥛',
  eggs:      '🥚',
  nuts:      '🌰',
  peanuts:   '🥜',
  soy:       '🫘',
  shellfish: '🦞',
  fish:      '🐟',
  sesame:    '🫙',
};

// ─── Payment options ──────────────────────────────────────────────────────────
// No payment provider is integrated: every order is paid in person.
// See docs/stabilization-execution.md ("Payment semantics").
export const PAYMENT_METHODS: { id: PaymentMethod; icon: React.ElementType }[] = [
  { id: 'cash', icon: Banknote },
];

export function paymentLabel(mode: OrderMode): string {
  return mode === 'delivery' ? 'Pay on Delivery' : mode === 'takeaway' ? 'Pay on Pickup' : 'Pay at the Table';
}
