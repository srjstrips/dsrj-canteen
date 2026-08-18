import { NavLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { visibleSections } from "./nav";
import { useOnlineStatus } from "../offline/useOnlineStatus";
import { usePendingSyncCount } from "../offline/offlineQueue";

export function Layout() {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const online = useOnlineStatus();
  const pendingCount = usePendingSyncCount();

  if (!user) return null;
  const sections = visibleSections(user.role);

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-border bg-card transition-transform lg:static lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2 border-b border-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-bold text-white">D</div>
          <div>
            <p className="text-sm font-bold leading-tight">Divya SRJ</p>
            <p className="text-xs leading-tight text-muted">Canteen System</p>
          </div>
        </div>
        <nav className="h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <div key={section.title} className="mb-4">
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</p>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `mb-0.5 block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive ? "bg-primary-light text-primary" : "text-ink hover:bg-background"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-ink/30 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
          <button className="rounded-lg p-2 hover:bg-background lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            ☰
          </button>
          <div className="flex items-center gap-3">
            {!online && (
              <span className="badge-danger" title="You are offline — bills will sync automatically when back online">
                Offline
              </span>
            )}
            {pendingCount > 0 && <span className="badge-success">{pendingCount} bill(s) pending sync</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs leading-tight text-muted">{user.role}</p>
            </div>
            <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={logout}>
              Logout
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
