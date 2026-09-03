import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";

const SCOPE_GROUPS: { title: string; scopes: { key: string; label: string; hint: string }[] }[] = [
  {
    title: "Transaction Logs",
    scopes: [
      { key: "POS_SALES", label: "Canteen bills (POS sales)", hint: "Counter sales + their stock movements. Bill numbers reset to 0001." },
      { key: "MANAGED_ORDERS", label: "OT / Guest / Contractor orders", hint: "Managed orders + their stock movements" },
      { key: "STORE_INWARD", label: "Store inward", hint: "Supplier receipts into store" },
      { key: "STORE_ISSUES", label: "Stock issues to canteen", hint: "Store → canteen issues" },
      { key: "STOCK_RETURNS", label: "Stock returns to store", hint: "Canteen → store returns" },
      { key: "WASTAGE", label: "Wastage", hint: "Canteen wastage entries" },
      { key: "CONSUMPTION", label: "Consumption", hint: "Canteen consumption entries" },
      { key: "ADJUSTMENTS", label: "Stock adjustments", hint: "Manual store/canteen corrections" },
    ],
  },
  {
    title: "Master Data",
    scopes: [
      { key: "FOOD_ITEMS", label: "Food items (menu)", hint: "Deletes food menu items that have never been billed" },
      { key: "SUPPLIERS", label: "Suppliers (unused)", hint: "Deletes suppliers that have no stock inward records" },
      { key: "STORE_PRODUCTS", label: "Store products (unused)", hint: "Deletes raw material products with no stock history" },
      { key: "EMPTY_CATEGORIES", label: "Empty categories", hint: "Deletes categories that have no products assigned" },
    ],
  },
];
const SCOPES = SCOPE_GROUPS.flatMap((g) => g.scopes);

export function ResetData() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [confirm, setConfirm] = useState("");

  // Full wipe (transactions + masters)
  const [fullConfirm, setFullConfirm] = useState("");

  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const cleanup = useMutation({
    mutationFn: async () =>
      api.post("/admin/cleanup", {
        confirm: "DELETE",
        scopes: selected,
        from: from || undefined,
        to: to || undefined,
      }),
    onSuccess: () => {
      toast.success("Selected data deleted");
      setSelected([]);
      setConfirm("");
      queryClient.clear();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const fullReset = useMutation({
    mutationFn: async () => api.post("/admin/reset", { confirm: "DELETE" }),
    onSuccess: () => {
      toast.success("All data cleared");
      setFullConfirm("");
      queryClient.clear();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const rangeLabel = from || to ? `${from || "start"} → ${to || "today"}` : "all dates";

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">Reset / Clean Data</h1>
        <p className="text-sm text-muted">Delete selected transaction types, optionally within a date range. Stock balances are recomputed automatically. User logins are always kept.</p>
      </div>

      {/* Selective cleanup */}
      <div className="card space-y-4">
        <h2 className="font-semibold">Selective delete</h2>

        {SCOPE_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.scopes.map((s) => (
                <label key={s.key} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${selected.includes(s.key) ? "border-primary bg-primary-light/40" : "border-border"}`}>
                  <input type="checkbox" className="mt-0.5" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} />
                  <span>
                    <span className="block text-sm font-medium">{s.label}</span>
                    <span className="block text-xs text-muted">{s.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-secondary !py-1.5 text-xs" onClick={() => setSelected(SCOPES.map((s) => s.key))}>
            Select all
          </button>
          <button className="btn-secondary !py-1.5 text-xs" onClick={() => setSelected([])}>
            Clear selection
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">From date (optional)</label>
            <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To date (optional)</label>
            <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted">Leave both dates empty to delete <strong>all</strong> of the selected types. Range: <strong>{rangeLabel}</strong>.</p>

        <div>
          <label className="label">Type <span className="font-mono font-semibold text-danger">DELETE</span> to confirm</label>
          <input className="input max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
        </div>

        <button
          className="btn-primary !bg-danger hover:!bg-danger/90"
          disabled={selected.length === 0 || confirm !== "DELETE" || cleanup.isPending}
          onClick={() => {
            if (window.confirm(`Delete ${selected.length} selected type(s) for ${rangeLabel}? This cannot be undone.`)) cleanup.mutate();
          }}
        >
          {cleanup.isPending ? "Deleting…" : "Delete selected"}
        </button>
      </div>

      {/* Full wipe */}
      <div className="card space-y-3 border border-danger/40">
        <h2 className="font-semibold text-danger">Danger zone — wipe everything</h2>
        <p className="text-sm text-muted">
          Deletes <strong>all transactions AND masters</strong> (products, food items, categories, units, suppliers, billing accounts) — everything except user logins. Use to start completely fresh.
        </p>
        <div>
          <label className="label">Type <span className="font-mono font-semibold text-danger">DELETE</span> to confirm</label>
          <input className="input max-w-xs" value={fullConfirm} onChange={(e) => setFullConfirm(e.target.value)} placeholder="DELETE" />
        </div>
        <button
          className="btn-primary !bg-danger hover:!bg-danger/90"
          disabled={fullConfirm !== "DELETE" || fullReset.isPending}
          onClick={() => {
            if (window.confirm("Delete ALL transactions and master data? This cannot be undone.")) fullReset.mutate();
          }}
        >
          {fullReset.isPending ? "Deleting…" : "Delete everything"}
        </button>
      </div>
    </div>
  );
}
