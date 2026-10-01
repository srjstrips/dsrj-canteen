import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { formatDate } from "../../lib/format";
import { exportToExcel } from "../../lib/excel";

interface ContractorBalance {
  accountId: string;
  name: string;
  balance: number;
}

interface TxnRow {
  id: string;
  txnType: string;
  quantity: number;
  balanceAfter: number;
  note: string | null;
  performedBy: string | null;
  createdAt: string;
}

interface DeductState {
  [accountId: string]: string;
}

function txnLabel(type: string) {
  if (type === "TOPUP") return <span className="badge-success">Top-up</span>;
  if (type === "DEDUCT") return <span className="badge-warning">Deduct</span>;
  return <span className="badge-muted">Reset</span>;
}

function ContractorHistory({ accountId }: { accountId: string }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const { data, isLoading } = useQuery({
    queryKey: ["token-history", accountId, month],
    queryFn: async () =>
      (await api.get<TxnRow[]>(`/tokens/${accountId}/history`, { params: { month } })).data,
  });

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide">Transaction History</p>
        <input
          className="input !py-0.5 !px-2 text-xs w-36"
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-xs text-muted">Loading…</p>}

      {!isLoading && (!data || data.length === 0) && (
        <p className="text-xs text-muted">No transactions for this month.</p>
      )}

      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="pb-1 pr-3">Date & Time</th>
                <th className="pb-1 pr-3">Type</th>
                <th className="pb-1 pr-3 text-right">Qty</th>
                <th className="pb-1 pr-3 text-right">Balance After</th>
                <th className="pb-1 pr-3">By</th>
                <th className="pb-1">Note</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted">
                    {new Date(t.createdAt).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-1.5 pr-3">{txnLabel(t.txnType)}</td>
                  <td className="py-1.5 pr-3 text-right font-medium">
                    {t.txnType === "TOPUP" ? `+${t.quantity}` : `${t.quantity}`}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-medium text-primary">{t.balanceAfter}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{t.performedBy ?? "—"}</td>
                  <td className="py-1.5 text-muted">{t.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

async function exportAllContractors(contractors: ContractorBalance[]) {
  if (!contractors || contractors.length === 0) return toast.error("No contractors found");
  toast.loading("Preparing export…", { id: "export" });
  try {
    const results = await Promise.all(
      contractors.map(async (c) => {
        const txns = (await api.get<TxnRow[]>(`/tokens/${c.accountId}/history`)).data;
        return txns.map((t) => ({
          Contractor: c.name,
          "Date & Time": new Date(t.createdAt).toLocaleString("en-IN", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit",
          }),
          Type: t.txnType,
          Quantity: t.quantity,
          "Balance After": t.balanceAfter,
          "Performed By": t.performedBy ?? "",
          Note: t.note ?? "",
        }));
      })
    );
    const rows = results.flat();
    if (rows.length === 0) return toast.error("No transactions to export", { id: "export" });
    exportToExcel("contractor-tokens", rows);
    toast.success("Exported!", { id: "export" });
  } catch {
    toast.error("Export failed", { id: "export" });
  }
}

export function ContractorTokens() {
  const queryClient = useQueryClient();
  const [deductQty, setDeductQty] = useState<DeductState>({});
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());

  const { data: contractors, isLoading } = useQuery({
    queryKey: ["token-balances"],
    queryFn: async () => (await api.get<ContractorBalance[]>("/tokens/balances")).data,
    refetchInterval: 60000,
  });

  const deductMutation = useMutation({
    mutationFn: async ({ accountId, quantity }: { accountId: string; quantity: number }) =>
      api.post<{ balance: number }>(`/tokens/${accountId}/deduct`, { quantity }),
    onSuccess: (res, { accountId }) => {
      toast.success(`Deducted — new balance: ${res.data.balance} tokens`);
      setDeductQty((prev) => ({ ...prev, [accountId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["token-balances"] });
      queryClient.invalidateQueries({ queryKey: ["token-history", accountId] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const handleDeduct = (accountId: string) => {
    const qty = parseInt(deductQty[accountId] ?? "", 10);
    if (!qty || qty <= 0) return toast.error("Enter a valid number of labourers");
    deductMutation.mutate({ accountId, quantity: qty });
  };

  const toggleHistory = (accountId: string) => {
    setOpenHistory((prev) => {
      const next = new Set(prev);
      next.has(accountId) ? next.delete(accountId) : next.add(accountId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Contractor Tokens</h1>
          <p className="text-sm text-muted">Enter today's labourer count for each contractor and deduct tokens.</p>
        </div>
        <button
          className="btn-secondary !py-1.5 text-xs"
          onClick={() => exportAllContractors(contractors ?? [])}
        >
          ⬇ Export Excel
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!isLoading && (!contractors || contractors.length === 0) && (
        <div className="card py-10 text-center text-muted">No contractor accounts found.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(contractors ?? []).map((c) => (
          <div key={c.accountId} className="card space-y-4">
            <div>
              <p className="font-semibold text-base">{c.name}</p>
              <p className="text-sm text-muted mt-0.5">
                Balance:{" "}
                <span className={`font-bold ${c.balance <= 0 ? "text-danger" : "text-primary"}`}>
                  {c.balance} tokens
                </span>
              </p>
            </div>

            <div className="flex gap-2">
              <input
                className="input flex-1"
                type="number"
                min={1}
                placeholder="Labourers today"
                value={deductQty[c.accountId] ?? ""}
                onChange={(e) =>
                  setDeductQty((prev) => ({ ...prev, [c.accountId]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && handleDeduct(c.accountId)}
              />
              <button
                className="btn-primary"
                disabled={deductMutation.isPending || c.balance <= 0}
                onClick={() => handleDeduct(c.accountId)}
              >
                Deduct
              </button>
            </div>

            {c.balance <= 0 && (
              <p className="text-xs text-danger">No tokens remaining — top up required.</p>
            )}

            <button
              className="text-xs text-primary underline text-left"
              onClick={() => toggleHistory(c.accountId)}
            >
              {openHistory.has(c.accountId) ? "Hide history" : "View history"}
            </button>

            {openHistory.has(c.accountId) && (
              <ContractorHistory accountId={c.accountId} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
