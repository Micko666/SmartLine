import { useState } from 'react';
import { Clock, Zap, Plus, Minus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { isActiveOrder, ORDER_STATUS_CSS, ORDER_STATUS_LABELS } from '@/domain/orderMachine';
import { toast } from 'sonner';

export default function PrepTimes() {
  const { orders, menuItems, adjustPrepTime, advanceOrderStatus } = useStore(useShallow(s => ({
    orders: s.orders,
    menuItems: s.menuItems,
    adjustPrepTime: s.adjustPrepTime,
    advanceOrderStatus: s.advanceOrderStatus,
  })));

  const activeOrders = orders.filter(o => o.status === 'paid' || o.status === 'preparing');

  const kitchenLoad = activeOrders.length > 4 ? 'high' : activeOrders.length > 2 ? 'medium' : 'low';
  const loadMultiplier = kitchenLoad === 'high' ? 1.4 : kitchenLoad === 'medium' ? 1.15 : 1;

  const handleAdjust = (orderId: string, delta: number) => {
    adjustPrepTime(orderId, delta);
    toast.success(`Prep time adjusted by ${delta > 0 ? '+' : ''}${delta} min`);
  };

  const handleMarkReady = (orderId: string, orderNumber: number) => {
    // Force advance to 'ready' regardless of current sub-state
    const order = orders.find(o => o.id === orderId);
    if (!order) return;
    advanceOrderStatus(orderId);
    toast.success(`#${orderNumber} marked Ready`);
  };

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="font-display text-2xl font-bold">Preparation Times</h1>
          <p className="text-muted-foreground text-sm mt-0.5">SmartLine dynamically adjusts estimates based on kitchen load</p>
        </div>

        {/* Kitchen load */}
        <div className="glass-card p-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className={`w-5 h-5 ${kitchenLoad === 'high' ? 'text-destructive' : kitchenLoad === 'medium' ? 'text-warning' : 'text-success'}`} />
              <span className="font-display font-semibold">Kitchen Load:</span>
              <span className={`status-badge ${kitchenLoad === 'high' ? 'bg-destructive/10 text-destructive' : kitchenLoad === 'medium' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                {kitchenLoad.toUpperCase()}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">{activeOrders.length} active orders · ×{loadMultiplier.toFixed(2)} multiplier</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, activeOrders.length * 18)}%` }}
              className={`h-full rounded-full ${kitchenLoad === 'high' ? 'bg-destructive' : kitchenLoad === 'medium' ? 'bg-warning' : 'bg-success'}`}
            />
          </div>
        </div>

        {/* Active orders */}
        {activeOrders.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-success mx-auto mb-3" />
            <p className="font-display font-semibold">Kitchen is clear</p>
            <p className="text-sm text-muted-foreground mt-1">No active paid or preparing orders.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {activeOrders.map(order => {
              const basePrepTime = order.estimatedPrepTime;
              const smartPrepTime = Math.round(basePrepTime * loadMultiplier);
              const adjustment = order.prepTimeAdjustment;
              const finalPrepTime = Math.max(1, smartPrepTime + adjustment);
              const elapsed = Math.round((Date.now() - new Date(order.createdAt).getTime()) / 60000);
              const remaining = Math.max(0, finalPrepTime - elapsed);
              const isOverdue = remaining === 0 && order.status !== 'ready';

              return (
                <motion.div key={order.id} layout className={`glass-card p-5 ${isOverdue ? 'border-destructive/30' : ''}`}>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-display font-bold">#{order.orderNumber}</span>
                        <span className={ORDER_STATUS_CSS[order.status]}>{ORDER_STATUS_LABELS[order.status]}</span>
                        <span className="text-xs text-muted-foreground">{order.tableName}</span>
                        {isOverdue && <span className="status-badge bg-destructive/10 text-destructive animate-pulse-soft">OVERDUE</span>}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {order.items.map(i => `${i.quantity}× ${i.menuItemName}`).join(', ')}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span>Base: {basePrepTime}min</span>
                        <span>Smart: {smartPrepTime}min</span>
                        {adjustment !== 0 && <span className="text-primary font-medium">Manual: {adjustment > 0 ? '+' : ''}{adjustment}min</span>}
                        <span className="font-semibold text-foreground">Final: {finalPrepTime}min</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-center">
                        <p className={`font-display text-3xl font-bold ${isOverdue ? 'text-destructive' : remaining <= 2 ? 'text-warning' : 'text-foreground'}`}>{remaining}</p>
                        <p className="text-[10px] text-muted-foreground">min left</p>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        <button onClick={() => handleAdjust(order.id, -5)} className="px-2 py-1.5 rounded-lg bg-muted text-xs font-medium hover:bg-muted/80 transition-colors">-5</button>
                        <button onClick={() => handleAdjust(order.id, 5)} className="px-2 py-1.5 rounded-lg bg-muted text-xs font-medium hover:bg-muted/80 transition-colors">+5</button>
                        <button onClick={() => handleAdjust(order.id, 10)} className="px-2 py-1.5 rounded-lg bg-muted text-xs font-medium hover:bg-muted/80 transition-colors">+10</button>
                        {order.status === 'preparing' && (
                          <button onClick={() => handleMarkReady(order.id, order.orderNumber)} className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-medium hover:bg-success/20 transition-colors flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Ready
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Base prep times reference */}
        <div className="glass-card p-5">
          <h3 className="font-display font-semibold mb-4">Base Preparation Times by Item</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {menuItems.filter(i => i.status === 'active').map(item => (
              <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-muted/50">
                <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {item.thumbnailUrl || item.imageUrl ? (
                    <img src={item.thumbnailUrl || item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                  ) : <span className="text-sm">{item.icon}</span>}
                </div>
                <span className="text-sm flex-1 truncate">{item.name}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <Clock className="w-3 h-3 text-muted-foreground" />
                  <span className="text-sm font-semibold">{item.prepTime}m</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
