import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '@/store';

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useStore(s => s.isAuthenticated);
  const hasHydrated = useStore(s => s._hasHydrated);
  const location = useLocation();

  // Wait for localStorage to rehydrate before deciding to redirect
  if (!hasHydrated) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
