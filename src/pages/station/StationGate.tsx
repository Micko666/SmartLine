/**
 * StationGate — PIN entry screen for station devices.
 * Accessed via /station/:restaurantToken/:stationId
 *
 * Auth model:
 *  - Resolves station config from public.ts (restaurantToken lookup)
 *  - If no PIN set, unlocks immediately
 *  - If PIN set, shows numpad; on success writes a 12-hour localStorage session
 *  - On valid session skip PIN and render the station view directly
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, ChefHat, Waves, UtensilsCrossed, Sliders } from 'lucide-react';
import { fetchRestaurantByToken } from '@/lib/supabase/queries/public';
import { isSessionValid, openSession, normalizeStation } from '@/domain/stations';
import { useStore } from '@/store';
import type { Station, StationRole } from '@/domain/types';
import { isSupabaseEnabled } from '@/store/flags';
import KitchenStation from './KitchenStation';
import ServiceStation from './ServiceStation';
import BarStation from './BarStation';

// ─── Component registry — exhaustive; add new roles here ─────────────────────
type StationProps = { station: Station; restaurantToken: string; userId: string; restaurantName: string; onLock: () => void };
const STATION_VIEWS: Record<StationRole, React.ComponentType<StationProps>> = {
  kitchen: KitchenStation,
  bar:     BarStation,
  service: ServiceStation,
  custom:  ServiceStation,  // Custom stations use the service view as a base
};

const ROLE_ICONS: Record<StationRole, React.ElementType> = {
  kitchen: ChefHat,
  service: UtensilsCrossed,
  bar: Waves,
  custom: Sliders,
};

// ─── Numpad ───────────────────────────────────────────────────────────────────

function Numpad({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  return (
    <div className="grid grid-cols-3 gap-3 w-56">
      {keys.map((k, i) => {
        if (!k) return <div key={i} />;
        if (k === '⌫') {
          return (
            <button
              key={k}
              onClick={() => onChange(value.slice(0, -1))}
              className="h-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground hover:bg-muted/80 active:scale-95 transition-all"
            >
              <Delete className="w-5 h-5" />
            </button>
          );
        }
        return (
          <button
            key={k}
            onClick={() => value.length < 6 && onChange(value + k)}
            className="h-14 rounded-2xl bg-muted text-foreground font-semibold text-lg hover:bg-muted/80 active:scale-95 transition-all select-none"
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}

// ─── Gate screen ─────────────────────────────────────────────────────────────

export default function StationGate() {
  const { restaurantToken, stationId } = useParams<{ restaurantToken: string; stationId: string }>();

  const [loading, setLoading] = useState(true);
  const [station, setStation] = useState<Station | null>(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  // PIN entry state
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);

  useEffect(() => {
    if (!restaurantToken || !stationId) {
      setError('Invalid station URL.');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        let res = await fetchRestaurantByToken(restaurantToken);

        // localStorage fallback — when Supabase is not configured, resolve the
        // restaurant from the currently loaded Zustand store (same device / demo mode).
        if (!res && !isSupabaseEnabled()) {
          const state = useStore.getState();
          if (state.settings?.restaurantToken === restaurantToken && state.user) {
            res = {
              userId:    state.user.id,
              settings:  state.settings,
              menuItems: state.menuItems,
              tables:    state.tables,
            };
          }
        }

        if (!res) { setError('Restaurant not found.'); setLoading(false); return; }

        const found = (res.settings?.stations ?? []).find((s: Station) => s.id === stationId);
        if (!found) { setError('Station not found.'); setLoading(false); return; }

        // Inject restaurant data into the store so station views (BarStation,
        // ServiceStation, KitchenStation) can read menuItems, tables, settings
        // without requiring an admin login on the device.
        useStore.setState({
          menuItems: res.menuItems,
          tables:    res.tables,
          settings:  res.settings,
          stations:  res.settings?.stations ?? [],
        });

        // Normalize fills in any permission fields missing from older station records
        setStation(normalizeStation(found));
        setRestaurantName(res.settings?.businessName ?? 'SmartLine');
        setUserId(res.userId);

        // Check existing session
        if (!found.pin || isSessionValid(stationId)) {
          openSession(stationId);
          setUnlocked(true);
        }
      } catch {
        setError('Failed to load station. Check your connection.');
      } finally {
        setLoading(false);
      }
    })();
  }, [restaurantToken, stationId]);

  // Physical keyboard support for PIN entry
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (unlocked || !station) return;
    if (e.key >= '0' && e.key <= '9') {
      setPin(prev => prev.length < 6 ? prev + e.key : prev);
    } else if (e.key === 'Backspace') {
      setPin(prev => prev.slice(0, -1));
    }
  }, [unlocked, station]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Auto-submit when PIN length matches
  useEffect(() => {
    if (!station?.pin || pin.length < 4) return;
    if (pin.length === station.pin.length || pin.length === 6) {
      if (pin === station.pin) {
        openSession(stationId!);
        setUnlocked(true);
      } else {
        setShake(true);
        setWrongAttempts(n => n + 1);
        setTimeout(() => { setPin(''); setShake(false); }, 600);
      }
    }
  }, [pin, station, stationId]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !station || !userId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4 bg-background">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <span className="text-3xl">⚠️</span>
        </div>
        <p className="text-foreground font-semibold text-lg">{error || 'Station not found'}</p>
        <p className="text-muted-foreground text-sm">Ask your manager to check the station URL or recreate the QR code.</p>
      </div>
    );
  }

  // ── Unlocked — render station view ───────────────────────────────────────────
  if (unlocked) {
    const props = { station, restaurantToken: restaurantToken!, userId, restaurantName, onLock: () => setUnlocked(false) };
    const StationView = STATION_VIEWS[station.role];
    return <StationView {...props} />;
  }

  // ── PIN gate ─────────────────────────────────────────────────────────────────
  const Icon = ROLE_ICONS[station.role];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-8 bg-background px-4"
      style={{ background: `linear-gradient(135deg, ${station.color}11 0%, transparent 60%)` }}
    >
      {/* Brand */}
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: station.color + '22', color: station.color }}
        >
          <Icon className="w-8 h-8" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">{restaurantName}</p>
          <h1 className="text-2xl font-display font-bold text-foreground mt-0.5">{station.name}</h1>
        </div>
      </div>

      {/* Dot indicators */}
      <div className="flex gap-3">
        {Array.from({ length: Math.max(station.pin.length, 4) }).map((_, i) => (
          <motion.div
            key={i}
            animate={{ scale: pin.length > i ? 1.2 : 1 }}
            className={`w-3 h-3 rounded-full transition-colors ${
              pin.length > i
                ? 'bg-primary'
                : 'bg-muted-foreground/30'
            }`}
          />
        ))}
      </div>

      {/* Numpad with shake on wrong */}
      <AnimatePresence mode="wait">
        <motion.div
          key={shake ? 'shake' : 'idle'}
          animate={shake ? { x: [0, -8, 8, -8, 8, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Numpad value={pin} onChange={setPin} />
        </motion.div>
      </AnimatePresence>

      {wrongAttempts > 0 && (
        <p className="text-sm text-destructive font-medium">
          Incorrect PIN{wrongAttempts > 2 ? ` (${wrongAttempts} attempts)` : ''}
        </p>
      )}

      <p className="text-xs text-muted-foreground">Enter your PIN to unlock this station</p>
    </div>
  );
}
