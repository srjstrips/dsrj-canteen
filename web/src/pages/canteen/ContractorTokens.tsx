import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { todayInput, formatDate } from "../../lib/format";

interface ContractorBalance {
  accountId: string;
  name: string;
  balance: number;
}

interface LabourEntry {
  id: string;
  accountId: string;
  accountName: string;
  entryDate: string;
  entryNo: number;
  labourName: string | null;
  status: string;
  servedAt: string | null;
  createdAt: string;
}

function isLocked(servedAt: string | null): boolean {
  if (!servedAt) return false;
  return Date.now() - new Date(servedAt).getTime() > 24 * 60 * 60 * 1000;
}

export function ContractorTokens() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayInput());

  const { data: contractors } = useQuery({
    queryKey: ["token-balances"],
    queryFn: async () => (await api.get<ContractorBalance[]>("/tokens/balances")).data,
  });

  const { data: entries, isLoading } = useQuery({
    queryKey: ["labour-entries", date],
    queryFn: async () =>
      (await api.get<LabourEntry[]>("/labour/pending", { params: { date } })).data,
    refetchInterval: 30000,
  });

  const serveMutation = useMutation({
    mutationFn: async (id: string) => api.post<{ balance: number }>(`/labour/${id}/serve`),
    onSuccess: (res, id) => {
      toast.success(`Served — contractor balance: ${res.data.balance} tokens`);
      queryClient.invalidateQueries({ queryKey: ["labour-entries", date] });
      queryClient.invalidateQueries({ queryKey: ["token-balances"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // Group entries by contractor
  const byContractor = (entries ?? []).reduce<Record<string, LabourEntry[]>>((acc, e) => {
    if (!acc[e.accountId]) acc[e.accountId] = [];
    acc[e.accountId].push(e);
    return acc;
  }, {});

  const balanceOf = (accountId: string) =>
    contractors?.find((c) => c.accountId === accountId)?.balance ?? "—";

  const pendingCount = (entries ?? []).filter((e) => e.status === "PENDING").length;
  const servedCount = (entries ?? []).filter((e) => e.status === "SERVED").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Contractor Tokens</h1>
        <p className="text-sm text-muted">Mark each labour as served when they eat. Served entries lock after 24 hours.</p>
      </div>

      {/* Date picker + summary */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <label className="label">Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        {entries && (
          <div className="flex gap-3 mt-5">
            <span className="badge-warning">{pendingCount} Pending</span>
            <span className="badge-success">{servedCount} Served</span>
          </div>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!isLoading && Object.keys(byContractor).length === 0 && (
        <div className="card py-10 text-center text-muted">
          No labour entries for {formatDate(date)}
        </div>
      )}

      {/* One card per contractor */}
      {Object.entries(byContractor).map(([accountId, items]) => (
        <div key={accountId} className="card overflow-x-auto p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div>
              <p className="font-semibold">{items[0].accountName}</p>
              <p className="text-xs text-muted">
                Token balance:{" "}
                <span className="font-medium text-primary">{balanceOf(accountId)}</span>
              </p>
            </div>
            <div className="flex gap-2 text-sm">
              <span className="badge-warning">{items.filter((e) => e.status === "PENDING").length} pending</span>
              <span className="badge-success">{items.filter((e) => e.status === "SERVED").length} served</span>
            </div>
          </div>

          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Status</th>
                <th>Served At</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => {
                const locked = isLocked(e.servedAt);
                return (
                  <tr key={e.id}>
                    <td className="text-muted">{e.entryNo}</td>
                    <td className="font-medium">
                      {e.labourName ?? <span className="text-muted">Labour {e.entryNo}</span>}
                    </td>
                    <td>
                      {e.status === "SERVED"
                        ? <span className="badge-success">Served</span>
                        : <span className="badge-warning">Pending</span>}
                    </td>
                    <td>
                      {e.servedAt
                        ? <span className={locked ? "text-muted text-xs" : ""}>{formatDate(e.servedAt)}</span>
                        : "—"}
                    </td>
                    <td>
                      {e.status === "PENDING" && (
                        <button
                          className="btn-primary !px-3 !py-1 text-xs"
                          disabled={serveMutation.isPending}
                          onClick={() => serveMutation.mutate(e.id)}
                        >
                          Mark Served
                        </button>
                      )}
                      {e.status === "SERVED" && locked && (
                        <span className="text-xs text-muted">Locked</span>
                      )}
                      {e.status === "SERVED" && !locked && (
                        <span className="text-xs text-muted">Served ✓</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
