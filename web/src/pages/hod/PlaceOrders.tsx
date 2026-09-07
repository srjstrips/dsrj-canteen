import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useBillingAccounts, useProducts } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { Combobox } from "../../components/Combobox";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { ManagedOrder, ManagedOrderType } from "../../types";

interface ItemRow {
  productId: string;
  quantity: string;
}

const OT_FOOD_NAME = "OVERTIME FOOD"; // must match exactly the food item name in DB

const shifts = ["Day", "Night"] as const;

export function PlaceOrders() {
  const queryClient = useQueryClient();
  const [orderType, setOrderType] = useState<ManagedOrderType>("OT");
  const [accountId, setAccountId] = useState("");
  const [shift, setShift] = useState<string>("Day");
  const [names, setNames] = useState("");

  // For GUEST / CONTRACTOR — manual item selection
  const [items, setItems] = useState<ItemRow[]>([{ productId: "", quantity: "1" }]);

  const isOT = orderType === "OT";
  const isContractor = orderType === "CONTRACTOR";
  const accountFilter = isContractor ? "CONTRACTOR" : "COMPANY";

  const { data: accounts } = useBillingAccounts({ type: accountFilter, activeOnly: true });
  const { data: allProducts } = useProducts(true);

  // Find the fixed OT food product
  const otFoodProduct = useMemo(
    () => allProducts?.find((p) => p.name.trim().toUpperCase() === OT_FOOD_NAME),
    [allProducts]
  );

  // Auto-pick company account for OT/GUEST
  useEffect(() => {
    if (!isContractor) setAccountId(accounts && accounts.length > 0 ? accounts[0].id : "");
    else setAccountId("");
  }, [isContractor, accounts]);

  const { data: todaysOrders } = useQuery({
    queryKey: ["managed-orders", "today"],
    queryFn: async () => (await api.get<ManagedOrder[]>("/managed/orders")).data,
  });

  // Parse comma/newline separated names, auto-trim, filter empty
  const parsedNames = useMemo(
    () => names.split(/[,\n]/).map((n) => n.trim()).filter(Boolean),
    [names]
  );

  // For OT: fixed 1 plate of OVERTIME FOOD per person
  const effectiveItems = useMemo(() => {
    if (isOT && otFoodProduct) return [{ productId: otFoodProduct.id, quantity: 1 }];
    return items.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) }));
  }, [isOT, otFoodProduct, items]);

  const estPerPerson = useMemo(() => {
    if (isOT && otFoodProduct) return Number(otFoodProduct.sellPrice ?? 0);
    if (!allProducts) return 0;
    return items.reduce((sum, it) => {
      const p = allProducts.find((x) => x.id === it.productId);
      return sum + (p?.sellPrice ? Number(p.sellPrice) * Number(it.quantity || 0) : 0);
    }, 0);
  }, [isOT, otFoodProduct, items, allProducts]);

  const [editing, setEditing] = useState<ManagedOrder | null>(null);
  const [editForm, setEditForm] = useState<{ dinerName: string; shift: string; items: ItemRow[] }>({
    dinerName: "",
    shift: "",
    items: [],
  });

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
        items: effectiveItems,
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
    if (parsedNames.length === 0) return toast.error("Enter at least one employee name");
    if (!accountId) return toast.error("Select a billing account");
    if (isOT && !otFoodProduct) return toast.error(`Food item "${OT_FOOD_NAME}" not found — ask Admin to create it in Food Items`);
    if (!isOT && items.some((it) => !it.productId || Number(it.quantity) <= 0))
      return toast.error("Every item needs a product and quantity");
    placeMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Place OT / Guest Orders</h1>
        <p className="text-sm text-muted">
          For OT: enter employee names separated by commas — one order per person with fixed Overtime Food.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        {/* Order type + account + shift */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Type</label>
            <select
              className="input"
              value={orderType}
              onChange={(e) => { setOrderType(e.target.value as ManagedOrderType); setAccountId(""); }}
            >
              <option value="OT">OT (Overtime)</option>
              <option value="GUEST">Guest</option>
            </select>
          </div>

          <div>
            <label className="label">Billed to</label>
            <div className="input flex items-center bg-background text-muted">
              {accounts && accounts.length > 0 ? accounts[0].name : "No company account — ask Admin to add one"}
            </div>
          </div>

          <div>
            <label className="label">Shift</label>
            <select className="input" value={shift} onChange={(e) => setShift(e.target.value)}>
              {shifts.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {/* OT: fixed food item info box */}
        {isOT && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${otFoodProduct ? "border-green-200 bg-green-50 text-green-800" : "border-orange-200 bg-orange-50 text-orange-800"}`}>
            {otFoodProduct ? (
              <>
                <span className="font-semibold">Food item fixed:</span> {otFoodProduct.name} — ₹{Number(otFoodProduct.sellPrice ?? 0).toFixed(2)} per person
              </>
            ) : (
              <>
                <span className="font-semibold">"{OT_FOOD_NAME}" not found.</span> Ask Admin to create this food item first.
              </>
            )}
          </div>
        )}

        {/* Employee names */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">{isOT ? "Employee name(s)" : "Diner name(s)"}</label>
            {parsedNames.length > 0 && (
              <span className="text-xs font-semibold text-primary">
                {parsedNames.length} {isOT ? "employee(s)" : "person(s)"}
                {isOT && otFoodProduct && parsedNames.length > 0 && (
                  <> · Total: {formatCurrency(estPerPerson * parsedNames.length)}</>
                )}
              </span>
            )}
          </div>
          <textarea
            className="input min-h-[80px]"
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={isOT ? "Ramesh Kumar, Suresh Singh, Mahesh Yadav, …" : "Enter names separated by commas"}
          />
          {parsedNames.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {parsedNames.map((n, i) => (
                <span key={i} className="rounded-full bg-primary-light px-2 py-0.5 text-xs font-medium text-primary">
                  {i + 1}. {n}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* GUEST: manual item selection */}
        {!isOT && (
          <div className="space-y-2">
            <label className="label">Food items (same for every person)</label>
            {items.map((it, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <select
                    className="input"
                    value={it.productId}
                    onChange={(e) => setItems(items.map((r, i) => (i === idx ? { ...r, productId: e.target.value } : r)))}
                  >
                    <option value="">Select food item…</option>
                    {allProducts?.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="w-24">
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
                >✕</button>
              </div>
            ))}
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setItems([...items, { productId: "", quantity: "1" }])}>
              + Add item
            </button>
            {estPerPerson > 0 && (
              <p className="text-sm text-muted">
                Est. per person: <span className="font-semibold text-ink">{formatCurrency(estPerPerson)}</span>
                {parsedNames.length > 1 && <> · Total: <span className="font-semibold text-ink">{formatCurrency(estPerPerson * parsedNames.length)}</span></>}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-3">
          <button className="btn-primary" type="submit" disabled={placeMutation.isPending}>
            {placeMutation.isPending ? "Placing…" : `Place ${parsedNames.length > 0 ? parsedNames.length : ""} Order(s)`}
          </button>
        </div>
      </form>

      {/* Today's orders table */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Today's orders</h2>
        <div className="card overflow-x-auto p-0">
          <table className="table-base min-w-[600px]">
            <thead>
              <tr>
                <th>Order No</th>
                <th>Employee / Diner</th>
                <th>Type</th>
                <th>Shift</th>
                <th>Status</th>
                <th>Placed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!todaysOrders?.length && (
                <tr><td colSpan={7} className="text-muted">No orders placed today.</td></tr>
              )}
              {todaysOrders?.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.orderNo}</td>
                  <td>{o.dinerName}</td>
                  <td>{o.orderType}</td>
                  <td>{o.shift ?? "—"}</td>
                  <td>
                    {o.status === "SERVED"
                      ? <span className="badge-success">Served</span>
                      : <span className="badge-info">Placed</span>}
                  </td>
                  <td>{formatDateTime(o.createdAt)}</td>
                  <td className="space-x-2 whitespace-nowrap text-right">
                    {o.status === "PLACED" ? (
                      <>
                        <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(o)}>Edit</button>
                        <button
                          className="btn-secondary !px-2 !py-1 text-xs text-danger"
                          disabled={deleteMutation.isPending}
                          onClick={() => { if (window.confirm(`Delete order for ${o.dinerName}?`)) deleteMutation.mutate(o.id); }}
                        >Delete</button>
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

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit order — ${editing?.orderNo ?? ""}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editForm.dinerName.trim()) return toast.error("Name is required");
            if (editForm.items.some((it) => !it.productId || Number(it.quantity) <= 0))
              return toast.error("Every item needs a product and quantity");
            editMutation.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Name</label>
              <input className="input" value={editForm.dinerName} onChange={(e) => setEditForm({ ...editForm, dinerName: e.target.value })} />
            </div>
            <div>
              <label className="label">Shift</label>
              <select className="input" value={editForm.shift} onChange={(e) => setEditForm({ ...editForm, shift: e.target.value })}>
                {shifts.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="label">Food items</label>
            {editForm.items.map((it, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1">
                  <select
                    className="input"
                    value={it.productId}
                    onChange={(e) => setEditForm({ ...editForm, items: editForm.items.map((r, i) => (i === idx ? { ...r, productId: e.target.value } : r)) })}
                  >
                    <option value="">Select…</option>
                    {allProducts?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
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
                <button type="button" className="btn-secondary !px-3" onClick={() => setEditForm({ ...editForm, items: editForm.items.filter((_, i) => i !== idx) })}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setEditForm({ ...editForm, items: [...editForm.items, { productId: "", quantity: "1" }] })}>
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
