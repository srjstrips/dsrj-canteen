import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Role } from "../types";

export function ProtectedRoute({ allow }: { allow?: Role[] }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="flex h-screen items-center justify-center text-muted">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role) && user.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
