/**
 * StationGate — PIN entry screen for station devices.
 * Accessed via /station/:restaurantToken/:stationId
 *
 * Supabase mode (server-verified):
 *  - station_public_config returns name/role/permissions/hasPin (never the PIN)
 *  - the PIN is sent once to station_login, which returns an opaque session
 *    token (12 h); every station RPC requires it and checks permissions
 *  - a stored, still-valid session skips the PIN; lock = server-side logout
 * Local/demo mode: station config comes from this browser's workspace and the
 *  PIN is compared locally (demo only — see docs/stabilization-execution.md).
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Delete, ChefHat, Waves, UtensilsCrossed, Sliders } from 'lucide-react';
import { closeSession, isSessionValid, openSession, normalizeStation } from '@/domain/stations';
import { useStore } from '@/store';
import type { Station, StationRole } from '@/domain/types';
import { isSupabaseEnabled } from '@/store/flags';
import * as stationService from '@/services/stationService';
import KitchenStation from './KitchenStation';
import ServiceStation from './ServiceStation';
import BarStation from './BarStation';

// ─── Component registry — exhaustive; add new roles here ─────────────────────
type StationProps = { station: Station; restaurantName: string; onLock: () => void };
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
  const remote = isSupabaseEnabled();

  const [loading, setLoading] = useState(true);
  const [station, setStation] = useState<Station | null>(null);
  const [restaurantName, setRestaurantName] = useState('');
  const [error, setError] = useState('');
  const [unlocked, setUnlocked] = useState(false);

  // PIN entry state
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [pinError, setPinError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /** Supabase: load floor/menu context with the stored session; false if it is gone. */
  const enterWithSession = useCallback(async (): Promise<boolean> => {
    if (!stationId) return false;
    const session = stationService.loadStationSession(stationId);
    if (!session) return false;
    try {
      const ctx = await stationService.fetchStationContext(session.token);
      useStore.getState().hydrateStationContext(ctx);
      setStation(ctx.station);
      setRestaurantName(ctx.restaurantName);
      setUnlocked(true);
      return true;
    } catch {
      stationService.clearStationSession(stationId);
      return false;
    }
  }, [stationId]);

  const login = useCallback(async (value: string | null) => {
    if (!restaurantToken || !stationId) return;
    setSubmitting(true);
    try {
      await stationService.loginStation(restaurantToken, stationId, value);
      if (!(await enterWithSession())) throw new Error('Could not open the station.');
      setPinError('');
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Login failed');
      setShake(true);
      setWrongAttempts(n => n + 1);
      setTimeout(() => { setPin(''); setShake(false); }, 600);
    } finally {
      setSubmitting(false);
    }
  }, [restaurantToken, stationId, enterWithSession]);

  useEffect(() => {
    if (!restaurantToken || !stationId) {
      setError('Invalid station URL.');
      setLoading(false);
      return;
    }

    (async () => {
      try {
        if (remote) {
          const config = await stationService.fetchStationConfig(restaurantToken, stationId).catch(() => null);
          if (!config) { setError('Station not found.'); return; }
          setStation(config.station);
          setRestaurantName(config.restaurantName);
          if (await enterWithSession()) return;
          if (!config.station.hasPin) await login(null);
          return;
        }

        // Local/demo mode: the station only exists in this browser's workspace.
        const state = useStore.getState();
        if (state.settings?.restaurantToken !== restaurantToken || !state.user) { setError('Restaurant not found.'); return; }
        const found = state.stations.find(s => s.id === stationId);
        if (!found) { setError('Station not found.'); return; }
        setStation(normalizeStation(found));
        setRestaurantName(state.settings.businessName ?? 'SmartLine');
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
  // Runs once per station URL; login/enter are stable for a given URL.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantToken, stationId, remote]);

  // Physical keyboard support for PIN entry
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (unlocked || !station) return;
    if (e.key >= '0' && e.key <= '9') {
      setPin(prev => prev.length < 6 ? prev + e.key : prev);
    } else if (e.key === 'Backspace') {
      setPin(prev => prev.slice(0, -1));
    } else if (e.key === 'Enter' && remote && pin.length >= 4) {
      void login(pin);
    }
  }, [unlocked, station, remote, pin, login]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Local mode: compare as soon as the PIN length matches. Supabase mode: the
  // device does not know the PIN length, so 6 digits auto-submit and shorter
  // PINs use the Unlock button / Enter.
  useEffect(() => {
    if (!station || unlocked || submitting) return;
    if (remote) {
      if (pin.length === 6) void login(pin);
      return;
    }
    if (!station.pin || pin.length < 4) return;
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
  }, [pin, station, stationId, unlocked, submitting, remote, login]);

  const lock = useCallback(() => {
    if (!stationId) return;
    if (remote) void stationService.logoutStation(stationId);
    else closeSession(stationId);
    setPin('');
    setUnlocked(false);
  }, [remote, stationId]);

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || !station) {
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
    const StationView = STATION_VIEWS[station.role];
    return <StationView station={station} restaurantName={restaurantName} onLock={lock} />;
  }

  // ── PIN gate ─────────────────────────────────────────────────────────────────
  const Icon = ROLE_ICONS[station.role];
  const dots = Math.max(remote ? pin.length : station.pin.length, 4);

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
        {Array.from({ length: dots }).map((_, i) => (
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

      {remote && (
        <button
          type="button"
          onClick={() => void login(pin)}
          disabled={pin.length < 4 || submitting}
          className="h-11 px-8 rounded-2xl bg-primary text-primary-foreground font-semibold disabled:opacity-40"
        >
          {submitting ? 'Checking…' : 'Unlock'}
        </button>
      )}

      {wrongAttempts > 0 && (
        <p className="text-sm text-destructive font-medium" role="alert">
          {pinError || 'Incorrect PIN'}{wrongAttempts > 2 ? ` (${wrongAttempts} attempts)` : ''}
        </p>
      )}

      <p className="text-xs text-muted-foreground">Enter your PIN to unlock this station</p>
    </div>
  );
}
