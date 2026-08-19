import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useBillingAccounts, useProducts } from "../../api/queries";
import { ProductSelect } from "../../components/ProductSelect";
import { Modal } from "../../components/Modal";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { ManagedOrder, ManagedOrderType } from "../../types";

interface ItemRow {
  productId: string;
  quantity: string;
}

const orderTypes: { value: ManagedOrderType; label: string }[] = [
  { value: "OT", label: "OT (Overtime)" },
  { value: "GUEST", label: "Guest" },
  { value: "CONTRACTOR", label: "Contractor" },
];

const shifts = ["Day", "Night"] as const;

export function PlaceOrders() {
  const queryClient = useQueryClient();
  const [orderType, setOrderType] = useState<ManagedOrderType>("OT");
  const [accountId, setAccountId] = useState("");
  const [shift, setShift] = useState<string>("Day");
  const [names, setNames] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ productId: "", quantity: "1" }]);

  const isContractor = orderType === "CONTRACTOR";
  const accountFilter = isContractor ? "CONTRACTOR" : "COMPANY";
  const { data: accounts } = useBillingAccounts({ type: accountFilter, activeOnly: true });
  const { data: products } = useProducts(true);

  // OT / Guest are always billed to the company — auto-pick it (there is only
  // one company account) so the HOD never has to choose. Contractor still picks.
  useEffect(() => {
    if (!isContractor) setAccountId(accounts && accounts.length > 0 ? accounts[0].id : "");
    else setAccountId("");
  }, [isContractor, accounts]);

  const { data: todaysOrders } = useQuery({
    queryKey: ["managed-orders", "today"],
    queryFn: async () => (await api.get<ManagedOrder[]>("/managed/orders")).data,
  });

  const parsedNames = useMemo(
    () => names.split(/[,\n]/).map((n) => n.trim()).filter(Boolean),
    [names]
  );

  const estPerPerson = useMemo(() => {
    if (!products) return 0;
    return items.reduce((sum, it) => {
      const p = products.find((x) => x.id === it.productId);
      return sum + (p?.sellPrice ? Number(p.sellPrice) * Number(it.quantity || 0) : 0);
    }, 0);
  }, [items, products]);

  const [editing, setEditing] = useState<ManagedOrder | null>(null);
  const [editForm, setEditForm] = useState<{ dinerName: string; shift: string; items: ItemRow[] }>({ dinerName: "", shift: "", items: [] });

  function openEdit(o: ManagedOrder) {
    setEditing(o);
    setEditForm({
      dinerName: o.dinerName,
      shift: o.shift ?? "",
      items: o.items.filter((i) => !i.isExtra).map((i) => ({ productId: i.productId, quantity: String(Number(i.quantity)) })),
    });
  }

  const editMutation = useMutation({
    mutationFn: async () =>
      api.patch(`/managed/orders/${editing!.id}`, {
        dinerName: editForm.dinerName,
        shift: editForm.shift || null,
        items: editForm.items.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
      }),
    onSuccess: () => {
      toast.success("Order updated");
      queryClient.invalidateQueries({ queryKey: ["managed-orders"] });
      setEditing(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/managed/orders/${id}`),
    onSuccess: () => {
      toast.success("Order deleted");
      queryClient.invalidateQueries({ queryKey: ["managed-orders"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const placeMutation = useMutation({
    mutationFn: async () =>
      api.post<ManagedOrder[]>("/managed/orders", {
        dinerNames: parsedNames,
        orderType,
        accountId,
        shift: shift || undefined,
        items: items.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) })),
      }),
    onSuccess: (res) => {
      toast.success(`${res.data.length} order(s) placed`);
      queryClient.invalidateQueries({ queryKey: ["managed-orders"] });
      setNames("");
      setItems([{ productId: "", quantity: "1" }]);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (parsedNames.length === 0) return toast.error("Enter at least one diner name");
    if (!accountId) return toast.error("Select a billing account");
    if (items.some((it) => !it.productId || Number(it.quantity) <= 0)) return toast.error("Every item needs a product and quantity");
    placeMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Place Orders — OT / Guest / Contractor</h1>
        <p className="text-sm text-muted">
          Enter names (comma or new-line separated) — one order is created per person. Items are billed at the standard sell price to the selected
          account.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={orderType}
              onChange={(e) => {
                setOrderType(e.target.value as ManagedOrderType);
                setAccountId("");
              }}
            >
              {orderTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          {isContractor ? (
            <div>
              <label className="label">Contractor</label>
              <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">Select contractor…</option>
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {accounts?.length === 0 && <p className="mt-1 text-xs text-danger">No contractor accounts — ask Admin to add one.</p>}
            </div>
          ) : (
            <div>
              <label className="label">Billed to</label>
              <div className="input flex items-center bg-background text-muted">
                {accounts && accounts.length > 0 ? accounts[0].name : "No company account — ask Admin to add one"}
              </div>
            </div>
          )}
          <div>
            <label className="label">Shift</label>
            <select className="input" value={shift} onChange={(e) => setShift(e.target.value)}>
              {shifts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Diner name(s)</label>
          <textarea
            className="input min-h-[72px]"
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder="Ramesh, Suresh, Mahesh — or one name per line"
          />
          {parsedNames.length > 0 && <p className="mt-1 text-xs text-muted">{parsedNames.length} order(s) will be created.</p>}
        </div>

        <div className="space-y-2">
          <label className="label">Food items (same for every person)</label>
          {items.map((it, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div className="flex-1">
                <ProductSelect value={it.productId} onChange={(v) => setItems(items.map((r, i) => (i === idx ? { ...r, productId: v } : r)))} />
              </div>
              <div className="w-28">
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.001"
                  value={it.quantity}
                  onChange={(e) => setItems(items.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)))}
                />
              </div>
              <button
                type="button"
                className="btn-secondary !px-3"
                onClick={() => setItems(items.length === 1 ? [{ productId: "", quantity: "1" }] : items.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setItems([...items, { productId: "", quantity: "1" }])}>
            + Add item
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className="text-sm text-muted">
            Est. per person: <span className="font-semibold text-ink">{formatCurrency(estPerPerson)}</span>
            {parsedNames.length > 1 && (
              <>
                {" · "}Total: <span className="font-semibold text-ink">{formatCurrency(estPerPerson * parsedNames.length)}</span>
              </>
            )}
          </p>
          <button className="btn-primary" type="submit" disabled={placeMutation.isPending}>
            {placeMutation.isPending ? "Placing…" : "Place Order(s)"}
          </button>
        </div>
      </form>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Today's orders</h2>
        <div className="card overflow-x-auto p-0">
          <table className="table-base">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Diner</th>
                <th>Type</th>
                <th>Account</th>
                <th>Shift</th>
                <th>Status</th>
                <th>Placed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {todaysOrders?.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-muted">
                    No orders placed today.
                  </td>
                </tr>
              )}
              {todaysOrders?.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.orderNo}</td>
                  <td>{o.dinerName}</td>
                  <td>{o.orderType}</td>
                  <td>{o.account.name}</td>
                  <td>{o.shift ?? "—"}</td>
                  <td>
                    {o.status === "SERVED" ? <span className="badge-success">Served</span> : <span className="badge-info">Placed</span>}
                  </td>
                  <td>{formatDateTime(o.createdAt)}</td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    {o.status === "PLACED" ? (
                      <>
                        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(o)}>
                          Edit
                        </button>
                        <button
                          className="btn-secondary !px-2 !py-1 text-xs text-danger"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Delete order for ${o.dinerName}?`)) deleteMutation.mutate(o.id);
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-muted">Served — locked</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit order — ${editing?.orderNo ?? ""}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editForm.dinerName.trim()) return toast.error("Diner name is required");
            if (editForm.items.length === 0 || editForm.items.some((it) => !it.productId || Number(it.quantity) <= 0))
              return toast.error("Every item needs a product and quantity");
            editMutation.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Diner name</label>
              <input className="input" value={editForm.dinerName} onChange={(e) => setEditForm({ ...editForm, dinerName: e.target.value })} />
            </div>
            <div>
              <label className="label">Shift</label>
              <select className="input" value={editForm.shift} onChange={(e) => setEditForm({ ...editForm, shift: e.target.value })}>
                {shifts.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="label">Food items</label>
            {editForm.items.map((it, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <ProductSelect
                    value={it.productId}
                    onChange={(v) => setEditForm({ ...editForm, items: editForm.items.map((r, i) => (i === idx ? { ...r, productId: v } : r)) })}
                  />
                </div>
                <div className="w-24">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    step="0.001"
                    value={it.quantity}
                    onChange={(e) => setEditForm({ ...editForm, items: editForm.items.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r)) })}
                  />
                </div>
                <button
                  type="button"
                  className="btn-secondary !px-3"
                  onClick={() => setEditForm({ ...editForm, items: editForm.items.filter((_, i) => i !== idx) })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => setEditForm({ ...editForm, items: [...editForm.items, { productId: "", quantity: "1" }] })}
            >
              + Add item
            </button>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={editMutation.isPending}>
            {editMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
