import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";

export function ResetData() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState("");

  const resetMutation = useMutation({
    mutationFn: async () => api.post("/admin/reset", { confirm: "DELETE" }),
    onSuccess: () => {
      toast.success("All data cleared");
      setConfirm("");
      queryClient.clear();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold">Reset Data</h1>
        <p className="text-sm text-muted">Permanently delete transactions and master data. User logins are kept.</p>
      </div>

      <div className="card space-y-4 border border-danger/40">
        <div>
          <h2 className="font-semibold text-danger">Danger zone</h2>
          <p className="mt-1 text-sm text-muted">
            This clears <span className="font-medium text-ink">everything except user accounts</span> — stock inward &amp; issues, sales, OT/Guest/Contractor
            orders, ledgers, wastage, adjustments, and all masters (products, categories, units, suppliers, billing accounts). This cannot be undone.
          </p>
        </div>

        <div>
          <label className="label">
            Type <span className="font-mono font-semibold text-danger">DELETE</span> to confirm
          </label>
          <input className="input max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="DELETE" />
        </div>

        <button
          className="btn-primary !bg-danger hover:!bg-danger/90"
          disabled={confirm !== "DELETE" || resetMutation.isPending}
          onClick={() => {
            if (window.confirm("Delete ALL transactions and master data? This cannot be undone.")) resetMutation.mutate();
          }}
        >
          {resetMutation.isPending ? "Deleting…" : "Delete all data"}
        </button>
      </div>
    </div>
  );
}
