import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatDate, todayInput } from "../../lib/format";

interface TokenTxn {
  id: string;
  txnType: string;
  quantity: number;
  pricePerToken: number | null;
  balanceAfter: number;
  note: string | null;
  createdAt: string;
}

interface LabourEntry {
  id: string;
  entryDate: string;
  entryNo: number;
  labourName: string | null;
  status: string;
  servedAt: string | null;
  createdAt: string;
}

export function ContractorPortal() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const accountId = user?.accountId;

  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  // Submit labour form state
  const [entryDate, setEntryDate] = useState(todayInput());
  const [count, setCount] = useState("1");
  const [names, setNames] = useState<string[]>([]);

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

  const { data: myEntries } = useQuery({
    queryKey: ["contractor-entries", accountId],
    queryFn: async () => (await api.get<LabourEntry[]>("/labour")).data,
    enabled: !!accountId,
  });

  const submitMutation = useMutation({
    mutationFn: async () =>
      api.post("/labour", {
        entryDate,
        count: Number(count),
        names: names.filter(Boolean),
      }),
    onSuccess: () => {
      toast.success(`${count} labour entries submitted`);
      queryClient.invalidateQueries({ queryKey: ["contractor-entries", accountId] });
      queryClient.invalidateQueries({ queryKey: ["contractor-balance", accountId] });
      setCount("1");
      setNames([]);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function handleCountChange(val: string) {
    const n = Math.max(1, Math.min(200, Number(val) || 1));
    setCount(String(n));
    setNames((prev) => {
      const next = [...prev];
      next.length = n;
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(count);
    if (!n || n < 1) return toast.error("Enter at least 1 labour");
    const bal = balance?.balance ?? 0;
    if (n > bal) return toast.error(`Only ${bal} tokens available`);
    submitMutation.mutate();
  }

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

  // Group entries by date for display
  const entriesByDate = (myEntries ?? []).reduce<Record<string, LabourEntry[]>>((acc, e) => {
    const key = e.entryDate;
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Contractor Portal</h1>
        <p className="text-sm text-muted">Submit your labours for the day and track token usage.</p>
      </div>

      {/* Balance card */}
      <div className="card max-w-xs">
        <p className="text-sm text-muted">Current Token Balance</p>
        {balanceLoading ? (
          <p className="mt-1 text-muted">Loading…</p>
        ) : (
          <p className={`mt-1 text-5xl font-bold ${bal === 0 ? "text-danger" : bal < 10 ? "text-warning" : "text-primary"}`}>
            {bal}
          </p>
        )}
        <p className="text-xs text-muted">tokens remaining</p>
      </div>

      {/* Submit labour form */}
      <div className="card max-w-2xl space-y-4">
        <h2 className="font-semibold">Send Labours for Food</h2>
        {bal === 0 ? (
          <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
            No tokens remaining. Contact admin to top up.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Date *</label>
                <input className="input" type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
              </div>
              <div>
                <label className="label">Number of Labours *</label>
                <input
                  className="input" type="number" min={1} max={bal} step={1} required
                  value={count}
                  onChange={(e) => handleCountChange(e.target.value)}
                />
                <p className="mt-0.5 text-xs text-muted">Max: {bal} (your token balance)</p>
              </div>
            </div>

            {/* Optional names */}
            {Number(count) > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Labour Names <span className="text-muted font-normal">(optional — leave blank to auto-number)</span></p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Array.from({ length: Number(count) }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-6 text-xs text-muted text-right flex-shrink-0">{i + 1}.</span>
                      <input
                        className="input !py-1.5 text-sm"
                        placeholder={`Labour ${i + 1}`}
                        value={names[i] ?? ""}
                        onChange={(e) => {
                          const next = [...names];
                          next[i] = e.target.value;
                          setNames(next);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={submitMutation.isPending}>
              {submitMutation.isPending ? "Submitting…" : `Submit ${count} Labour(s)`}
            </button>
          </form>
        )}
      </div>

      {/* My submitted entries grouped by date */}
      {Object.keys(entriesByDate).length > 0 && (
        <div className="card space-y-4">
          <h2 className="font-semibold">My Labour Entries</h2>
          {Object.entries(entriesByDate)
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, entries]) => (
              <div key={date}>
                <p className="mb-2 text-sm font-semibold text-muted">{formatDate(date)}</p>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Served At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td>{e.entryNo}</td>
                          <td>{e.labourName ?? <span className="text-muted">Labour {e.entryNo}</span>}</td>
                          <td>
                            {e.status === "SERVED"
                              ? <span className="badge-success">Served</span>
                              : <span className="badge-warning">Pending</span>}
                          </td>
                          <td>{e.servedAt ? formatDate(e.servedAt) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Token history */}
      <div className="card space-y-3">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold">Token History</h2>
          <input className="input !py-1 text-sm" type="month" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} />
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
              {!history?.length && <tr><td colSpan={5} className="text-center text-muted">No transactions this month</td></tr>}
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
