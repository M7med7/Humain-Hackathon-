import { Suspense } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function ProtectedRoute() {
  const { session, loading } = useAuth();

  const loadingScreen = (
    <div role="status" aria-busy="true" className="flex h-screen items-center justify-center bg-black">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
    </div>
  );

  if (loading) {
    return loadingScreen;
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Suspense fallback={loadingScreen}>
      <Outlet />
    </Suspense>
  );
}
