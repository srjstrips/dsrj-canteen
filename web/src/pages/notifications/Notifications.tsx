import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Bell, Package, ShoppingCart, Users, ClipboardList, Ticket, CheckCircle } from "lucide-react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const TYPE_ICON: Record<string, React.ElementType> = {
  STOCK_RECEIVED: Package,
  POS_SALE: ShoppingCart,
  CONTRACTOR_LABOUR: Users,
  ORDER_PLACED: ClipboardList,
  TOKEN_TOPUP: Ticket,
  EXTRA_RESOLVED: CheckCircle,
};

function NotifCard({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const Icon = TYPE_ICON[n.type] ?? Bell;
  const time = new Date(n.createdAt);
  const timeStr = time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${n.read ? "border-border bg-card" : "border-primary/30 bg-primary-light/20"}`}
      onClick={() => { if (!n.read) onRead(n.id); }}
      style={{ cursor: n.read ? "default" : "pointer" }}
    >
      <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${n.read ? "bg-background" : "bg-primary-light"}`}>
        <Icon className={`h-4 w-4 ${n.read ? "text-muted" : "text-primary"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${n.read ? "text-ink" : "text-primary"}`}>{n.title}</p>
        <p className="text-xs text-muted mt-0.5">{n.body}</p>
      </div>
      <span className="text-xs text-muted flex-shrink-0 mt-0.5">{timeStr}</span>
    </div>
  );
}

function groupNotifications(items: Notification[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: { label: string; items: Notification[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Older", items: [] },
  ];

  for (const n of items) {
    const d = new Date(n.createdAt);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() === today.getTime()) groups[0].items.push(n);
    else if (d.getTime() === yesterday.getTime()) groups[1].items.push(n);
    else groups[2].items.push(n);
  }

  return groups.filter((g) => g.items.length > 0);
}

export function Notifications() {
  const qc = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    queryFn: () => api.get("/notifications").then((r) => r.data),
    refetchInterval: 30_000,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = notifications.filter((n) => !n.read).length;
  const groups = groupNotifications(notifications);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Notifications</h1>
          {unread > 0 && <p className="text-xs text-muted mt-0.5">{unread} unread</p>}
        </div>
        {unread > 0 && (
          <button className="btn-secondary text-xs !px-3 !py-1.5" onClick={() => markAll.mutate()}>
            Mark all read
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}
      {!isLoading && notifications.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-muted">
          <Bell className="mx-auto mb-2 h-8 w-8 opacity-30" />
          <p className="text-sm">No notifications yet</p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.label}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.label}</p>
          <div className="space-y-2">
            {group.items.map((n) => (
              <NotifCard key={n.id} n={n} onRead={(id) => markOne.mutate(id)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
