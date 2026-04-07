import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import useAuthStore from '@/store/authStore';

export default function ProtectedRoute({ allowedRoles }) {
  const { isAuthenticated, user, fetchUser } = useAuthStore();
  const [loading, setLoading] = useState(!user && isAuthenticated);

  useEffect(() => {
    if (isAuthenticated && !user) {
      fetchUser().finally(() => setLoading(false));
    }
  }, [isAuthenticated, user, fetchUser]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" replace />;
  }

  return <Outlet />;
}
