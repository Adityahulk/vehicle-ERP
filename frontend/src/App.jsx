import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import InventoryPage from './pages/InventoryPage';
import SalesPage from './pages/SalesPage';
import LoansPage from './pages/LoansPage';
import ExpensesPage from './pages/ExpensesPage';
import SettingsPage from './pages/SettingsPage';
import ReportsPage from './pages/ReportsPage';
import AttendancePage from './pages/AttendancePage';
import VehicleDetailPage from './pages/VehicleDetailPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import useAuthStore from './store/authStore';

function DefaultRedirect() {
  const { user } = useAuthStore();
  const target = user?.role === 'ca' ? '/reports' : '/dashboard';
  return <Navigate to={target} replace />;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    },
  },
});

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Toaster position="top-right" richColors closeButton duration={3000} />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/unauthorized" element={<UnauthorizedPage />} />

            {/* CA-accessible routes — invoices (read-only) + reports */}
            <Route element={<ProtectedRoute />}>
              <Route path="/sales" element={<SalesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            {/* Operational routes — all except CA */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager', 'staff']} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
              <Route path="/loans" element={<LoansPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
              <Route path="/attendance" element={<AttendancePage />} />
            </Route>

            {/* Admin-only routes */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin']} />}>
              <Route path="/settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<DefaultRedirect />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
