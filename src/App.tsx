import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import AdminGuard from '@/components/admin/AdminGuard';
import AuthProvider from '@/components/providers/AuthProvider';

// ── Lazy-loaded pages — each becomes its own JS chunk ────────────────────────
// Customers visiting /menu only download the Menu chunk + shared deps,
// not the admin panel, floor map, analytics charts, QR generator, etc.

const Login          = lazy(() => import('./pages/Login'));
const Signup         = lazy(() => import('./pages/Signup'));

const CustomerMenu    = lazy(() => import('./pages/customer/Menu'));
const CustomerReceipt = lazy(() => import('./pages/customer/Receipt'));
const OrderTracker    = lazy(() => import('./pages/customer/OrderTracker'));

const Dashboard      = lazy(() => import('./pages/admin/Dashboard'));
const Orders         = lazy(() => import('./pages/admin/Orders'));
const MenuManager    = lazy(() => import('./pages/admin/MenuManager'));
const Inventory      = lazy(() => import('./pages/admin/Inventory'));
const Tables         = lazy(() => import('./pages/admin/Tables'));
const PrepTimes      = lazy(() => import('./pages/admin/PrepTimes'));
const Analytics      = lazy(() => import('./pages/admin/Analytics'));
const Ingredients    = lazy(() => import('./pages/admin/Ingredients'));
const Settings       = lazy(() => import('./pages/admin/Settings'));
const Stations       = lazy(() => import('./pages/admin/Stations'));
const CalendarPage   = lazy(() => import('./pages/admin/Calendar'));

const BookingPage    = lazy(() => import('./pages/customer/BookingPage'));

const StationGate    = lazy(() => import('./pages/station/StationGate'));

const NotFound       = lazy(() => import('./pages/NotFound'));

// ── Minimal fallback — renders nothing visible while chunk loads ──────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* ── Public auth ── */}
              <Route path="/" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* ── Public customer surface ── */}
              <Route path="/menu" element={<CustomerMenu />} />
              <Route path="/receipt/:receiptId" element={<CustomerReceipt />} />
              <Route path="/track" element={<OrderTracker />} />

              {/* ── Protected admin routes ── */}
              <Route path="/dashboard"    element={<AdminGuard><Dashboard /></AdminGuard>} />
              <Route path="/orders"       element={<AdminGuard><Orders /></AdminGuard>} />
              <Route path="/menu-manager" element={<AdminGuard><MenuManager /></AdminGuard>} />
              <Route path="/inventory"    element={<AdminGuard><Inventory /></AdminGuard>} />
              <Route path="/tables"       element={<AdminGuard><Tables /></AdminGuard>} />
              <Route path="/prep-times"   element={<AdminGuard><PrepTimes /></AdminGuard>} />
              <Route path="/analytics"    element={<AdminGuard><Analytics /></AdminGuard>} />
              <Route path="/ingredients"  element={<AdminGuard><Ingredients /></AdminGuard>} />
              <Route path="/settings"     element={<AdminGuard><Settings /></AdminGuard>} />
              <Route path="/stations"     element={<AdminGuard><Stations /></AdminGuard>} />
              <Route path="/calendar"     element={<AdminGuard><CalendarPage /></AdminGuard>} />

              {/* ── Public customer booking ── */}
              <Route path="/book/:restaurantToken" element={<BookingPage />} />

              {/* ── Station devices (public, PIN gated) ── */}
              <Route path="/station/:restaurantToken/:stationId" element={<StationGate />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
