import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { formatDate } from "../../lib/format";

interface ContractorBalance {
  accountId: string;
  name: string;
  balance: number;
}

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

function useContractorBalances() {
  return useQuery({
    queryKey: ["token-balances"],
    queryFn: async () => (await api.get<ContractorBalance[]>("/tokens/balances")).data,
  });
}

export function ContractorTokens() {
  const queryClient = useQueryClient();
  const { data: contractors, isLoading } = useContractorBalances();

  const [selectedId, setSelectedId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const selected = contractors?.find((c) => c.accountId === selectedId);

  const { data: history } = useQuery({
    queryKey: ["token-history-canteen", selectedId],
    queryFn: async () => (await api.get<TokenTxn[]>(`/tokens/${selectedId}/history`)).data,
    enabled: !!selectedId,
  });

  const deductMutation = useMutation({
    mutationFn: async () =>
      api.post<{ balance: number }>(`/tokens/${selectedId}/deduct`, {
        quantity: Number(quantity),
        note: note || undefined,
      }),
    onSuccess: (res) => {
      toast.success(`${quantity} token(s) deducted. Remaining: ${res.data.balance}`);
      queryClient.invalidateQueries({ queryKey: ["token-balances"] });
      queryClient.invalidateQueries({ queryKey: ["token-history-canteen", selectedId] });
      setQuantity("");
      setNote("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!selectedId) return toast.error("Select a contractor");
    const qty = Number(quantity);
    if (!qty || qty <= 0) return toast.error("Enter a valid number of labours");
    if (selected && qty > selected.balance) {
      return toast.error(`Only ${selected.balance} tokens available`);
    }
    if (!window.confirm(`Serve ${qty} labour(s) for ${selected?.name}? ${qty} token(s) will be deducted.`)) return;
    deductMutation.mutate();
  }

  function txnLabel(type: string) {
    if (type === "TOPUP") return <span className="badge-success">Top-up</span>;
    if (type === "DEDUCT") return <span className="badge-warning">Served</span>;
    return <span className="badge-danger">Reset</span>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Contractor Tokens</h1>
        <p className="text-sm text-muted">Select a contractor, verify their token balance, then serve labours.</p>
      </div>

      {/* Contractor selector + balance cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {contractors?.map((c) => (
          <button
            key={c.accountId}
            type="button"
            onClick={() => { setSelectedId(c.accountId); setQuantity(""); setNote(""); }}
            className={`card text-left transition-all ${selectedId === c.accountId ? "ring-2 ring-primary" : "hover:shadow-md"}`}
          >
            <p className="font-semibold">{c.name}</p>
            <p className={`mt-1 text-2xl font-bold ${c.balance === 0 ? "text-danger" : c.balance < 10 ? "text-warning" : "text-primary"}`}>
              {c.balance}
            </p>
            <p className="text-xs text-muted">tokens remaining</p>
          </button>
        ))}
      </div>

      {/* Serve form */}
      {selected && (
        <div className="card max-w-md space-y-4">
          <div>
            <h2 className="font-semibold">{selected.name}</h2>
            <p className="text-sm text-muted">
              Available:{" "}
              <span className={`font-bold ${selected.balance === 0 ? "text-danger" : selected.balance < 10 ? "text-warning" : "text-primary"}`}>
                {selected.balance} tokens
              </span>
            </p>
          </div>

          {selected.balance === 0 ? (
            <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
              No tokens remaining. Ask admin to top up.
            </p>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">Number of Labours *</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={selected.balance}
                  step={1}
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="How many labours eating today?"
                />
                {quantity && Number(quantity) > 0 && (
                  <p className="mt-1 text-xs text-muted">
                    Balance after: <strong>{selected.balance - Number(quantity)} tokens</strong>
                  </p>
                )}
              </div>
              <div>
                <label className="label">Note (optional)</label>
                <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Morning shift" />
              </div>
              <button className="btn-primary w-full" type="submit" disabled={deductMutation.isPending}>
                {deductMutation.isPending ? "Processing…" : "Serve & Deduct Tokens"}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Today's history for selected contractor */}
      {selected && history && history.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <h2 className="p-4 pb-0 font-semibold">Transaction History — {selected.name}</h2>
          <table className="table-base mt-2">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Tokens</th>
                <th>Balance After</th>
                <th>Note</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.createdAt)}</td>
                  <td>{txnLabel(t.txnType)}</td>
                  <td className={t.quantity < 0 ? "text-danger font-medium" : "text-primary font-medium"}>
                    {t.quantity > 0 ? "+" : ""}{t.quantity}
                  </td>
                  <td>{t.balanceAfter}</td>
                  <td>{t.note ?? "—"}</td>
                  <td>{t.performedBy ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
