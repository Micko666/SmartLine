import { useState } from 'react';
import { Lock, Wifi, WifiOff } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Station } from '@/domain/types';
import { closeSession } from '@/domain/stations';

interface StationLayoutProps {
  station: Station;
  restaurantName: string;
  onLock: () => void;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
  online?: boolean;
}

export default function StationLayout({
  station,
  restaurantName,
  onLock,
  children,
  headerExtra,
  online = true,
}: StationLayoutProps) {
  const [lockConfirm, setLockConfirm] = useState(false);

  function handleLock() {
    if (!station.pin) { onLock(); return; }
    if (lockConfirm) {
      closeSession(station.id);
      onLock();
    } else {
      setLockConfirm(true);
      setTimeout(() => setLockConfirm(false), 3000);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      {/* Top bar */}
      <header
        className="h-12 flex items-center px-4 gap-3 shrink-0 border-b border-border"
        style={{ borderBottom: `2px solid ${station.color}33` }}
      >
        {/* Color accent dot */}
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: station.color }}
        />
        <span className="font-semibold text-sm text-foreground">{station.name}</span>
        <span className="text-muted-foreground text-xs hidden sm:block">· {restaurantName}</span>

        <div className="flex-1" />

        {headerExtra}

        {/* Online indicator */}
        <span className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
          {online
            ? <Wifi className="w-3.5 h-3.5 text-green-500" />
            : <WifiOff className="w-3.5 h-3.5 text-destructive" />}
        </span>

        {/* Lock */}
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={handleLock}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            lockConfirm
              ? 'bg-destructive text-destructive-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          {lockConfirm ? 'Tap again to lock' : 'Lock'}
        </motion.button>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
