import useAuthStore from '@/store/authStore';
import AdminDashboard from './AdminDashboard';
import BranchDashboard from './BranchDashboard';

const ADMIN_ROLES = ['super_admin', 'company_admin'];

export default function DashboardPage() {
  const { user } = useAuthStore();

  if (ADMIN_ROLES.includes(user?.role)) {
    return <AdminDashboard />;
  }

  return <BranchDashboard />;
}
