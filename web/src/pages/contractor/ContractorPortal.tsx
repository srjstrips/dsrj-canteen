import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatDate } from "../../lib/format";

interface TokenTxn {
  id: string;
  txnType: string;
  quantity: number;
  pricePerToken: number | null;
  balanceAfter: number;
  note: string | null;
  performedBy: string | null;
  createdAt: string;
}

export function ContractorPortal() {
  const { user } = useAuth();
  const accountId = user?.accountId;
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ["contractor-balance", accountId],
    queryFn: async () => (await api.get<{ balance: number }>(`/tokens/${accountId}/balance`)).data,
    enabled: !!accountId,
  });

  const { data: history } = useQuery({
    queryKey: ["contractor-history", accountId, historyMonth],
    queryFn: async () =>
      (await api.get<TokenTxn[]>(`/tokens/${accountId}/history`, { params: { month: historyMonth } })).data,
    enabled: !!accountId,
  });

  function txnLabel(type: string) {
    if (type === "TOPUP") return <span className="badge-success">Top-up</span>;
    if (type === "DEDUCT") return <span className="badge-warning">Served</span>;
    return <span className="badge-danger">Reset</span>;
  }

  if (!accountId) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-lg font-semibold text-danger">No billing account linked to your login.</p>
        <p className="mt-1 text-sm text-muted">Please ask the Admin to link your account.</p>
      </div>
    );
  }

  const bal = balance?.balance ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Contractor Portal</h1>
        <p className="text-sm text-muted">View your token balance and usage history.</p>
      </div>

      {/* Balance card */}
      <div className="card max-w-sm">
        <p className="text-sm text-muted">Current Token Balance</p>
        {balanceLoading ? (
          <p className="mt-1 text-muted">Loading…</p>
        ) : (
          <p className={`mt-1 text-5xl font-bold ${bal === 0 ? "text-danger" : bal < 10 ? "text-warning" : "text-primary"}`}>
            {bal}
          </p>
        )}
        <p className="mt-1 text-sm text-muted">tokens remaining</p>
        {bal === 0 && (
          <p className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
            No tokens left. Please contact the canteen admin to top up.
          </p>
        )}
      </div>

      {/* Monthly history */}
      <div className="card space-y-4">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold">Token History</h2>
          <div>
            <input
              className="input !py-1 text-sm"
              type="month"
              value={historyMonth}
              onChange={(e) => setHistoryMonth(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Tokens</th>
                <th>Balance After</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {!history?.length && (
                <tr><td colSpan={5} className="text-center text-muted">No transactions this month</td></tr>
              )}
              {history?.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.createdAt)}</td>
                  <td>{txnLabel(t.txnType)}</td>
                  <td className={t.quantity < 0 ? "font-medium text-danger" : "font-medium text-primary"}>
                    {t.quantity > 0 ? "+" : ""}{t.quantity}
                  </td>
                  <td>{t.balanceAfter}</td>
                  <td>{t.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
