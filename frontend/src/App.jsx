import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import ErrorBoundary from './components/ErrorBoundary';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import BranchDashboard from './pages/BranchDashboard';
import InventoryPage from './pages/InventoryPage';
import SalesPage from './pages/SalesPage';
import LoansPage from './pages/LoansPage';
import ExpensesPage from './pages/ExpensesPage';
import SettingsPage from './pages/SettingsPage';
import ReportsPage from './pages/ReportsPage';
import MyAttendance from './pages/MyAttendance';
import ManagerAttendance from './pages/ManagerAttendance';
import VehicleDetailPage from './pages/VehicleDetailPage';
import UnauthorizedPage from './pages/UnauthorizedPage';
import PurchaseList from './pages/purchases/PurchaseList';
import PurchaseForm from './pages/purchases/PurchaseForm';
import PurchaseDetail from './pages/purchases/PurchaseDetail';
import PurchaseReceive from './pages/purchases/PurchaseReceive';
import QuotationsPage from './pages/Quotations';
import QuotationFormPage from './pages/QuotationForm';
import QuotationDetailPage from './pages/QuotationDetail';
import CADashboard from './pages/ca/CADashboard';
import useAuthStore from './store/authStore';

const ADMIN_ROLES = ['super_admin', 'company_admin'];
const MANAGER_ROLES = ['super_admin', 'company_admin', 'branch_manager'];
const MY_ATTENDANCE_ROLES = ['staff', 'branch_manager', 'company_admin', 'super_admin'];

function DefaultRedirect() {
  const { user } = useAuthStore();
  if (user?.role === 'ca') return <Navigate to="/ca/dashboard" replace />;
  if (user?.role === 'staff') return <Navigate to="/my-attendance" replace />;
  if (user?.role === 'branch_manager') return <Navigate to="/branch-dashboard" replace />;
  return <Navigate to="/dashboard" replace />;
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

            <Route element={<ProtectedRoute allowedRoles={MY_ATTENDANCE_ROLES} />}>
              <Route path="/my-attendance" element={<MyAttendance />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['branch_manager']} />}>
              <Route path="/branch-dashboard" element={<BranchDashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={ADMIN_ROLES} />}>
              <Route path="/dashboard" element={<DashboardPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'ca']} />}>
              <Route path="/reports" element={<ReportsPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['ca', 'super_admin', 'company_admin']} />}>
              <Route path="/ca/dashboard" element={<CADashboard />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager', 'ca']} />}>
              <Route path="/sales" element={<SalesPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager', 'ca']} />}>
              <Route path="/loans" element={<LoansPage />} />
              <Route path="/expenses" element={<ExpensesPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager']} />}>
              <Route path="/purchases/new" element={<PurchaseForm />} />
              <Route path="/purchases/:id/edit" element={<PurchaseForm />} />
              <Route path="/purchases/:id/receive" element={<PurchaseReceive />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager', 'ca']} />}>
              <Route path="/purchases" element={<PurchaseList />} />
              <Route path="/purchases/:id" element={<PurchaseDetail />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager']} />}>
              <Route path="/quotations/new" element={<QuotationFormPage />} />
              <Route path="/quotations/:id/edit" element={<QuotationFormPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager', 'ca']} />}>
              <Route path="/quotations" element={<QuotationsPage />} />
              <Route path="/quotations/:id" element={<QuotationDetailPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={MANAGER_ROLES} />}>
              <Route path="/inventory" element={<InventoryPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={['super_admin', 'company_admin', 'branch_manager', 'ca']} />}>
              <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
            </Route>

            <Route element={<ProtectedRoute allowedRoles={MANAGER_ROLES} />}>
              <Route path="/attendance" element={<ManagerAttendance />} />
            </Route>

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
