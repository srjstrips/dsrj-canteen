import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useBillingAccounts } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { MasterImport } from "../../components/MasterImport";
import { BillingAccount, BillingAccountType } from "../../types";
import { formatDate } from "../../lib/format";

const emptyForm = { name: "", type: "COMPANY" as BillingAccountType, contactPerson: "", mobile: "" };

interface TokenBalance { accountId: string; name: string; balance: number; }
interface TokenTxn {
  id: string; txnType: string; quantity: number;
  pricePerToken: number | null; balanceAfter: number;
  note: string | null; performedBy: string | null; createdAt: string;
}

function useTokenBalances() {
  return useQuery({
    queryKey: ["token-balances"],
    queryFn: async () => (await api.get<TokenBalance[]>("/tokens/balances")).data,
  });
}

export function BillingAccounts() {
  const queryClient = useQueryClient();
  const { data: accounts, isLoading } = useBillingAccounts();
  const { data: tokenBalances } = useTokenBalances();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BillingAccount | null>(null);
  const [form, setForm] = useState(emptyForm);

  // Token top-up modal
  const [topupAccount, setTopupAccount] = useState<BillingAccount | null>(null);
  const [topupQty, setTopupQty] = useState("");
  const [topupPrice, setTopupPrice] = useState("45");
  const [topupNote, setTopupNote] = useState("");

  // History modal
  const [historyAccount, setHistoryAccount] = useState<BillingAccount | null>(null);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data: historyData } = useQuery({
    queryKey: ["token-history", historyAccount?.id, historyMonth],
    queryFn: async () =>
      (await api.get<TokenTxn[]>(`/tokens/${historyAccount!.id}/history`, { params: { month: historyMonth } })).data,
    enabled: !!historyAccount,
  });

  const saveMutation = useMutation({
    mutationFn: async () => (editing ? api.patch(`/managed/accounts/${editing.id}`, form) : api.post("/managed/accounts", form)),
    onSuccess: () => {
      toast.success(editing ? "Account updated" : "Account added");
      queryClient.invalidateQueries({ queryKey: ["billing-accounts"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (a: BillingAccount) => api.patch(`/managed/accounts/${a.id}`, { active: !a.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billing-accounts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: BillingAccount) => api.delete(`/managed/accounts/${a.id}`),
    onSuccess: () => { toast.success("Account deleted"); queryClient.invalidateQueries({ queryKey: ["billing-accounts"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const topupMutation = useMutation({
    mutationFn: async () =>
      api.post(`/tokens/${topupAccount!.id}/topup`, {
        quantity: Number(topupQty),
        pricePerToken: Number(topupPrice),
        note: topupNote || undefined,
      }),
    onSuccess: () => {
      toast.success(`Tokens added to ${topupAccount!.name}`);
      queryClient.invalidateQueries({ queryKey: ["token-balances"] });
      setTopupAccount(null); setTopupQty(""); setTopupNote("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const resetMutation = useMutation({
    mutationFn: async (a: BillingAccount) => api.post(`/tokens/${a.id}/reset`, {}),
    onSuccess: (_, a) => {
      toast.success(`Tokens reset for ${a.name}`);
      queryClient.invalidateQueries({ queryKey: ["token-balances"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function openEdit(a: BillingAccount) {
    setEditing(a);
    setForm({ name: a.name, type: a.type, contactPerson: a.contactPerson ?? "", mobile: a.mobile ?? "" });
    setOpen(true);
  }

  function balanceOf(accountId: string) {
    return tokenBalances?.find((b) => b.accountId === accountId)?.balance ?? 0;
  }

  function txnLabel(type: string) {
    if (type === "TOPUP") return <span className="badge-success">Top-up</span>;
    if (type === "DEDUCT") return <span className="badge-warning">Served</span>;
    return <span className="badge-danger">Reset</span>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Billing Accounts</h1>
          <p className="text-sm text-muted">Who receives the month-end bill — the Company (OT &amp; Guests) and each Contractor firm.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}>
          + New Account
        </button>
      </div>

      <MasterImport
        entity="billing-accounts"
        filename="billing-accounts-template.xlsx"
        hint="Download the template, fill one account per row (Name and Type COMPANY/CONTRACTOR required), then upload."
        invalidateKey={["billing-accounts"]}
      />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Contact</th>
              <th>Mobile</th>
              <th>Token Balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7}>Loading…</td></tr>}
            {accounts?.map((a) => (
              <tr key={a.id}>
                <td className="font-medium">{a.name}</td>
                <td>{a.type === "COMPANY" ? <span className="badge-success">Company</span> : <span className="badge-warning">Contractor</span>}</td>
                <td>{a.contactPerson ?? "—"}</td>
                <td>{a.mobile ?? "—"}</td>
                <td>
                  {a.type === "CONTRACTOR" ? (
                    <span className={`font-semibold ${balanceOf(a.id) === 0 ? "text-danger" : balanceOf(a.id) < 10 ? "text-warning" : "text-primary"}`}>
                      {balanceOf(a.id)} tokens
                    </span>
                  ) : "—"}
                </td>
                <td>{a.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(a)}>Edit</button>
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate(a)}>
                    {a.active ? "Deactivate" : "Activate"}
                  </button>
                  {a.type === "CONTRACTOR" && (
                    <>
                      <button
                        className="btn-primary !px-2 !py-1 text-xs"
                        onClick={() => { setTopupAccount(a); setTopupQty(""); setTopupNote(""); }}
                      >
                        + Add Tokens
                      </button>
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs"
                        onClick={() => setHistoryAccount(a)}
                      >
                        History
                      </button>
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs text-danger"
                        disabled={resetMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Reset token balance for "${a.name}" to 0?`)) resetMutation.mutate(a);
                        }}
                      >
                        Reset Tokens
                      </button>
                    </>
                  )}
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs text-danger"
                    disabled={deleteMutation.isPending}
                    onClick={() => { if (window.confirm(`Delete account "${a.name}"? This only works if it has no orders.`)) deleteMutation.mutate(a); }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Account create/edit modal */}
      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Account" : "New Account"}>
        <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); saveMutation.mutate(); }}>
          <div>
            <label className="label">Account Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as BillingAccountType })}>
              <option value="COMPANY">Company (OT &amp; Guests)</option>
              <option value="CONTRACTOR">Contractor</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Contact Person</label>
              <input className="input" value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} />
            </div>
            <div>
              <label className="label">Mobile</label>
              <input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </div>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save Account"}
          </button>
        </form>
      </Modal>

      {/* Add tokens modal */}
      <Modal open={!!topupAccount} onClose={() => setTopupAccount(null)} title={`Add Tokens — ${topupAccount?.name ?? ""}`}>
        <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); topupMutation.mutate(); }}>
          <p className="text-sm text-muted">
            Current balance: <strong>{topupAccount ? balanceOf(topupAccount.id) : 0} tokens</strong>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Tokens to Add *</label>
              <input
                className="input" type="number" min={1} step={1} required
                value={topupQty} onChange={(e) => setTopupQty(e.target.value)}
                placeholder="e.g. 50"
              />
            </div>
            <div>
              <label className="label">Price per Token (₹) *</label>
              <input
                className="input" type="number" min={0} step={0.01} required
                value={topupPrice} onChange={(e) => setTopupPrice(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={topupNote} onChange={(e) => setTopupNote(e.target.value)} placeholder="e.g. September top-up" />
          </div>
          {topupQty && (
            <p className="rounded-lg bg-background px-3 py-2 text-sm">
              New balance will be: <strong>{balanceOf(topupAccount?.id ?? "") + Number(topupQty)} tokens</strong>
              {" · "}Total value: <strong>₹{(Number(topupQty) * Number(topupPrice)).toFixed(2)}</strong>
            </p>
          )}
          <button className="btn-primary w-full" type="submit" disabled={topupMutation.isPending}>
            {topupMutation.isPending ? "Adding…" : "Add Tokens"}
          </button>
        </form>
      </Modal>

      {/* History modal */}
      <Modal open={!!historyAccount} onClose={() => setHistoryAccount(null)} title={`Token History — ${historyAccount?.name ?? ""}`} wide>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div>
              <label className="label">Month</label>
              <input className="input" type="month" value={historyMonth} onChange={(e) => setHistoryMonth(e.target.value)} />
            </div>
            <div className="mt-5 text-sm text-muted">
              Current balance: <strong>{historyAccount ? balanceOf(historyAccount.id) : 0} tokens</strong>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Tokens</th>
                  <th>Rate (₹)</th>
                  <th>Balance After</th>
                  <th>Note</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {!historyData?.length && <tr><td colSpan={7} className="text-center text-muted">No transactions this month</td></tr>}
                {historyData?.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.createdAt)}</td>
                    <td>{txnLabel(t.txnType)}</td>
                    <td className={t.quantity < 0 ? "text-danger font-medium" : "text-primary font-medium"}>
                      {t.quantity > 0 ? "+" : ""}{t.quantity}
                    </td>
                    <td>{t.pricePerToken != null ? `₹${t.pricePerToken}` : "—"}</td>
                    <td>{t.balanceAfter}</td>
                    <td>{t.note ?? "—"}</td>
                    <td>{t.performedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  );
}
