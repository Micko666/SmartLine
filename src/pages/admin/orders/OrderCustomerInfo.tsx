import { toast } from 'sonner';
import type { Order } from '@/domain/types';
import { isOutstandingPayment } from '@/domain/orderMachine';
import { useStore } from '@/store';
import { PAYMENT_STATUS_LABEL } from './shared';

/** Structured customer contact (new orders) with a fallback note for legacy orders. */
export default function OrderCustomerInfo({ order }: { order: Order }) {
  const recordPayment = useStore(s => s.recordPayment);
  const contact = [order.customerName, order.customerPhone].filter(Boolean).join(' · ');
  if (!contact && !order.deliveryAddress && !order.paymentStatus) return null;
  return (
    <div className="text-xs text-muted-foreground mb-2 space-y-0.5">
      {contact && <p className="font-medium text-foreground">{contact}</p>}
      {order.deliveryAddress && <p>{order.deliveryAddress}</p>}
      {order.paymentStatus && (
        <p className="flex items-center gap-2">
          <span>{PAYMENT_STATUS_LABEL[order.paymentStatus]} · {order.paymentMethod === 'cash' ? 'in person' : order.paymentMethod}</span>
          {isOutstandingPayment(order) && (
            <button
              type="button"
              onClick={() => { void recordPayment(order.id).then(ok => { if (ok) toast.success(`#${order.orderNumber} marked paid`); }); }}
              className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 dark:text-green-400 font-medium hover:bg-green-500/20"
            >
              Mark paid
            </button>
          )}
        </p>
      )}
    </div>
  );
}
