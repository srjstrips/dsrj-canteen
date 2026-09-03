import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useSuppliers } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { MasterImport } from "../../components/MasterImport";
import { Supplier } from "../../types";

const emptyForm = { name: "", contactPerson: "", mobile: "", address: "", gstNumber: "", paymentTerms: "" };

export function Suppliers() {
  const queryClient = useQueryClient();
  const { data: suppliers, isLoading } = useSuppliers();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState(emptyForm);

  const saveMutation = useMutation({
    mutationFn: async () => (editing ? api.patch(`/masters/suppliers/${editing.id}`, form) : api.post("/masters/suppliers", form)),
    onSuccess: () => {
      toast.success(editing ? "Supplier updated" : "Supplier added");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (s: Supplier) => api.patch(`/masters/suppliers/${s.id}`, { active: !s.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suppliers"] }),
  });

  const deleteSupplier = useMutation({
    mutationFn: async (s: Supplier) => api.delete(`/masters/suppliers/${s.id}`),
    onSuccess: () => {
      toast.success("Supplier deleted");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({
      name: s.name,
      contactPerson: s.contactPerson ?? "",
      mobile: s.mobile ?? "",
      address: s.address ?? "",
      gstNumber: s.gstNumber ?? "",
      paymentTerms: s.paymentTerms ?? "",
    });
    setOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Supplier Master</h1>
          <p className="text-sm text-muted">Suppliers used on Stock Inward</p>
        </div>
        <button
          className="btn-primary"
          onClick={() => {
            setEditing(null);
            setForm(emptyForm);
            setOpen(true);
          }}
        >
          + New Supplier
        </button>
      </div>

      <MasterImport
        entity="suppliers"
        filename="suppliers-template.xlsx"
        hint="Download the template, fill one supplier per row (Name required), then upload."
        invalidateKey={["suppliers"]}
      />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Mobile</th>
              <th>GST No.</th>
              <th>Payment Terms</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7}>Loading…</td>
              </tr>
            )}
            {suppliers?.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.name}</td>
                <td>{s.contactPerson ?? "—"}</td>
                <td>{s.mobile ?? "—"}</td>
                <td>{s.gstNumber ?? "—"}</td>
                <td>{s.paymentTerms ?? "—"}</td>
                <td>{s.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(s)}>
                    Edit
                  </button>
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate(s)}>
                    {s.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    className="btn-danger !px-2 !py-1 text-xs"
                    onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteSupplier.mutate(s); }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Supplier" : "New Supplier"}>
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div>
            <label className="label">Supplier Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
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
          <div>
            <label className="label">Address</label>
            <input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">GST Number</label>
              <input className="input" value={form.gstNumber} onChange={(e) => setForm({ ...form, gstNumber: e.target.value })} />
            </div>
            <div>
              <label className="label">Payment Terms</label>
              <input className="input" placeholder="e.g. Net 30" value={form.paymentTerms} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} />
            </div>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save Supplier"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
