/**
 * OrderTracker — public order status page.
 * URL: /track?r={restaurantToken}&n={orderNumber}
 * Polls get_order_status RPC every 10 seconds.
 */
import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase/client';
import { Clock, CheckCircle2, ChefHat, Utensils, Package } from 'lucide-react';
import { minutesSince } from '@/lib/time';

interface OrderStatusData {
  orderNumber: number;
  status: string;
  tableName: string;
  estimatedPrepTime: number;
  prepTimeAdjustment: number;
  paidAt: string;
  restaurantName: string;
}

const POLL_MS = 10_000;

const STATUS_CONFIG: Record<string, {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  done: boolean;
}> = {
  paid: {
    label: 'Order Received',
    description: 'Your order is in the queue and will start preparing shortly.',
    icon: Package,
    color: '#eab308',
    bg: 'bg-yellow-500/10',
    done: false,
  },
  preparing: {
    label: 'Being Prepared',
    description: 'The kitchen is working on your order right now.',
    icon: ChefHat,
    color: '#f97316',
    bg: 'bg-orange-500/10',
    done: false,
  },
  ready: {
    label: 'Ready!',
    description: 'Your order is ready and on its way to your table.',
    icon: CheckCircle2,
    color: '#22c55e',
    bg: 'bg-green-500/10',
    done: false,
  },
  completed: {
    label: 'Delivered',
    description: 'Enjoy your meal!',
    icon: Utensils,
    color: '#22c55e',
    bg: 'bg-green-500/10',
    done: true,
  },
  cancelled: {
    label: 'Cancelled',
    description: 'This order has been cancelled. Please speak to a member of staff.',
    icon: Package,
    color: '#ef4444',
    bg: 'bg-red-500/10',
    done: true,
  },
};

const STATUS_ORDER = ['paid', 'preparing', 'ready'];

function estimatedRemaining(data: OrderStatusData): number | null {
  if (data.status !== 'paid' && data.status !== 'preparing') return null;
  const elapsed = minutesSince(data.paidAt);
  const total = data.estimatedPrepTime + data.prepTimeAdjustment;
  return Math.max(0, total - elapsed);
}

// ─── Progress Steps ───────────────────────────────────────────────────────────

function ProgressSteps({ status }: { status: string }) {
  const currentIdx = STATUS_ORDER.indexOf(status);
  if (currentIdx === -1) return null; // cancelled/completed — don't show steps

  return (
    <div className="flex items-center gap-0 w-full max-w-xs mx-auto">
      {STATUS_ORDER.map((s, i) => {
        const cfg = STATUS_CONFIG[s];
        const done = i < currentIdx;
        const active = i === currentIdx;
        const Icon = cfg.icon;
        return (
          <div key={s} className="flex items-center flex-1">
            <div className={`flex flex-col items-center gap-1 ${i === STATUS_ORDER.length - 1 ? 'flex-1' : ''}`}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all ${
                active
                  ? 'border-primary bg-primary text-primary-foreground scale-110'
                  : done
                    ? 'border-green-500 bg-green-500 text-white'
                    : 'border-border bg-background text-muted-foreground'
              }`}>
                {done
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <Icon className="w-4 h-4" />
                }
              </div>
              <span className={`text-[10px] font-medium text-center leading-tight ${
                active ? 'text-primary' : done ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'
              }`}>
                {STATUS_CONFIG[s].label.split(' ')[0]}
              </span>
            </div>
            {i < STATUS_ORDER.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 rounded-full transition-colors ${
                done ? 'bg-green-500' : active ? 'bg-primary/30' : 'bg-border'
              }`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrderTracker() {
  const [params] = useSearchParams();
  const token = params.get('r') ?? '';
  const orderNumber = parseInt(params.get('n') ?? '0', 10);

  const [data, setData] = useState<OrderStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'not_found' | 'error' | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!supabase || !token || !orderNumber) {
      setError('error');
      setLoading(false);
      return;
    }

    const { data: result, error: rpcError } = await supabase.rpc('get_order_status', {
      p_restaurant_token: token,
      p_order_number: orderNumber,
    });

    if (rpcError || !result) {
      setError('error');
      setLoading(false);
      return;
    }

    const row = result as { ok: boolean } & OrderStatusData;
    if (!row.ok) {
      setError('not_found');
      setLoading(false);
      return;
    }

    setData(row);
    setError(null);
    setLastUpdated(new Date());
    setLoading(false);
  }, [token, orderNumber]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const cfg = data ? (STATUS_CONFIG[data.status] ?? STATUS_CONFIG['paid']) : null;
  const remaining = data ? estimatedRemaining(data) : null;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p className="text-sm text-muted-foreground">Looking up your order…</p>
          </div>
        )}

        {/* Error */}
        {!loading && error === 'not_found' && (
          <div className="text-center space-y-3 py-12">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground">Order not found</p>
            <p className="text-sm text-muted-foreground">
              Order #{orderNumber} couldn't be found. Please check your receipt or ask a member of staff.
            </p>
          </div>
        )}

        {!loading && error === 'error' && (
          <div className="text-center space-y-3 py-12">
            <p className="font-semibold text-foreground">Something went wrong</p>
            <p className="text-sm text-muted-foreground">Unable to load order status. Please try again.</p>
            <button
              onClick={fetchStatus}
              className="px-4 py-2 rounded-xl border border-border text-sm text-foreground hover:bg-muted transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Status */}
        {!loading && !error && data && cfg && (
          <>
            {/* Restaurant name */}
            {data.restaurantName && (
              <p className="text-center text-sm text-muted-foreground font-medium">{data.restaurantName}</p>
            )}

            {/* Main status card */}
            <div className={`rounded-2xl border p-6 text-center space-y-4 ${cfg.bg}`}
              style={{ borderColor: cfg.color + '30' }}
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
                style={{ backgroundColor: cfg.color + '20', color: cfg.color }}
              >
                <cfg.icon className="w-8 h-8" />
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Order #{data.orderNumber} · {data.tableName}
                </p>
                <h1 className="text-2xl font-display font-bold text-foreground">{cfg.label}</h1>
                <p className="text-sm text-muted-foreground mt-1">{cfg.description}</p>
              </div>

              {/* Time remaining */}
              {remaining !== null && remaining > 0 && (
                <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-background/60">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold text-foreground">
                    ~{remaining} min remaining
                  </span>
                </div>
              )}
              {remaining === 0 && data.status === 'preparing' && (
                <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-background/60">
                  <Clock className="w-4 h-4 text-orange-500" />
                  <span className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                    Almost ready…
                  </span>
                </div>
              )}
            </div>

            {/* Progress steps */}
            {!cfg.done && <ProgressSteps status={data.status} />}

            {/* Last updated */}
            {lastUpdated && (
              <p className="text-center text-xs text-muted-foreground">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' · '}refreshes every 10s
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
