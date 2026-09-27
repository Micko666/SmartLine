import type { Order } from '@/domain/types';
import { PAYMENT_STATUS_LABEL } from './shared';

/** Structured customer contact (new orders) with a fallback note for legacy orders. */
export default function OrderCustomerInfo({ order }: { order: Order }) {
  const contact = [order.customerName, order.customerPhone].filter(Boolean).join(' · ');
  if (!contact && !order.deliveryAddress && !order.paymentStatus) return null;
  return (
    <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
      {contact && <p className="font-medium text-foreground">{contact}</p>}
      {order.deliveryAddress && <p>{order.deliveryAddress}</p>}
      {order.paymentStatus && <p>{PAYMENT_STATUS_LABEL[order.paymentStatus]} · {order.paymentMethod === 'cash' ? 'in person' : order.paymentMethod}</p>}
    </div>
  );
}
