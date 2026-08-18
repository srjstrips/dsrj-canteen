import { ReactNode } from "react";

export function StatCard({
  label,
  value,
  tone = "default",
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "success" | "danger";
  hint?: string;
  icon?: ReactNode;
}) {
  const valueColor = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-ink";
  return (
    <div className="card flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className={`mt-1 text-2xl font-bold ${valueColor}`}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      {icon && <div className="rounded-lg bg-primary-light p-2 text-primary">{icon}</div>}
    </div>
  );
}
