import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAuth } from "@/lib/auth";

/**
 * Wraps a route element and redirects unauthenticated users to /login.
 * Shows nothing during the initial session load to avoid flash-of-login.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate("/login", { replace: true, state: { from: location.pathname } });
    }
  }, [isLoading, isAuthenticated, navigate, location.pathname]);

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-paper">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-pine border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <>{children}</>;
}
