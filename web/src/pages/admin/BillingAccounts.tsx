import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useBillingAccounts } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { MasterImport } from "../../components/MasterImport";
import { BillingAccount, BillingAccountType } from "../../types";

const emptyForm = { name: "", type: "COMPANY" as BillingAccountType, contactPerson: "", mobile: "" };

export function BillingAccounts() {
  const queryClient = useQueryClient();
  const { data: accounts, isLoading } = useBillingAccounts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BillingAccount | null>(null);
  const [form, setForm] = useState(emptyForm);

  const saveMutation = useMutation({
    mutationFn: async () => (editing ? api.patch(`/managed/accounts/${editing.id}`, form) : api.post("/managed/accounts", form)),
    onSuccess: () => {
      toast.success(editing ? "Account updated" : "Account added");
      queryClient.invalidateQueries({ queryKey: ["billing-accounts"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (a: BillingAccount) => api.patch(`/managed/accounts/${a.id}`, { active: !a.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["billing-accounts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (a: BillingAccount) => api.delete(`/managed/accounts/${a.id}`),
    onSuccess: () => {
      toast.success("Account deleted");
      queryClient.invalidateQueries({ queryKey: ["billing-accounts"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function openEdit(a: BillingAccount) {
    setEditing(a);
    setForm({ name: a.name, type: a.type, contactPerson: a.contactPerson ?? "", mobile: a.mobile ?? "" });
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Billing Accounts</h1>
          <p className="text-sm text-muted">Who receives the month-end bill — the Company (OT &amp; Guests) and each Contractor firm.</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setForm(emptyForm);
            setOpen(true);
          }}
        >
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
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            )}
            {accounts?.map((a) => (
              <tr key={a.id}>
                <td className="font-medium">{a.name}</td>
                <td>{a.type === "COMPANY" ? <span className="badge-success">Company</span> : <span className="badge-warning">Contractor</span>}</td>
                <td>{a.contactPerson ?? "—"}</td>
                <td>{a.mobile ?? "—"}</td>
                <td>{a.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(a)}>
                    Edit
                  </button>
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate(a)}>
                    {a.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="btn-secondary !px-2 !py-1 text-xs text-danger"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete account "${a.name}"? This only works if it has no orders.`)) deleteMutation.mutate(a);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Account" : "New Account"}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
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
    </div>
  );
}
