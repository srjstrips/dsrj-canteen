import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage, imageSrc } from "../../api/client";
import { useBillingAccounts, useFoodItems, useProducts } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { ManagedOrder, ManagedOrderType, Product } from "../../types";

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

  // For CONTRACTOR — manual item selection (legacy dropdown rows, not used for GUEST any more)
  const [items, setItems] = useState<ItemRow[]>([{ productId: "", quantity: "1" }]);

  const isOT = orderType === "OT";
  const isContractor = orderType === "CONTRACTOR";
  const accountFilter = isContractor ? "CONTRACTOR" : "COMPANY";

  const { data: accounts } = useBillingAccounts({ type: accountFilter, activeOnly: true });
  const { data: allProducts } = useProducts(true);
  const { data: foodItems } = useFoodItems();

  // Food card selection: productId -> quantity (only selected items are in the map)
  const [selectedCards, setSelectedCards] = useState<Record<string, number>>({});
  // Active category tab for food card browser ("all" = no filter)
  const [activeCategory, setActiveCategory] = useState<string>("all");

  function toggleCard(productId: string) {
    setSelectedCards((prev) => {
      if (prev[productId]) {
        const next = { ...prev };
        delete next[productId];
        return next;
      }
      return { ...prev, [productId]: 1 };
    });
  }

  function setCardQty(productId: string, qty: number) {
    if (qty <= 0) {
      setSelectedCards((prev) => { const next = { ...prev }; delete next[productId]; return next; });
    } else {
      setSelectedCards((prev) => ({ ...prev, [productId]: qty }));
    }
  }

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

  // For OT: fixed 1 plate of OVERTIME FOOD per person; for GUEST: card selection
  const effectiveItems = useMemo(() => {
    if (isOT && otFoodProduct) return [{ productId: otFoodProduct.id, quantity: 1 }];
    if (isContractor) return items.map((it) => ({ productId: it.productId, quantity: Number(it.quantity) }));
    // GUEST — from card selection
    return Object.entries(selectedCards).map(([productId, quantity]) => ({ productId, quantity }));
  }, [isOT, isContractor, otFoodProduct, items, selectedCards]);

  const estPerPerson = useMemo(() => {
    if (isOT && otFoodProduct) return Number(otFoodProduct.sellPrice ?? 0);
    if (isContractor) {
      if (!allProducts) return 0;
      return items.reduce((sum, it) => {
        const p = allProducts.find((x) => x.id === it.productId);
        return sum + (p?.sellPrice ? Number(p.sellPrice) * Number(it.quantity || 0) : 0);
      }, 0);
    }
    // GUEST — from card selection
    if (!foodItems) return 0;
    return Object.entries(selectedCards).reduce((sum, [productId, qty]) => {
      const p = foodItems.find((x) => x.id === productId);
      return sum + (p?.sellPrice ? Number(p.sellPrice) * qty : 0);
    }, 0);
  }, [isOT, isContractor, otFoodProduct, items, selectedCards, allProducts, foodItems]);

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
      setSelectedCards({});
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (parsedNames.length === 0) return toast.error("Enter at least one employee name");
    if (!accountId) return toast.error("Select a billing account");
    if (isOT && !otFoodProduct) return toast.error(`Food item "${OT_FOOD_NAME}" not found — ask Admin to create it in Food Items`);
    if (isContractor && items.some((it) => !it.productId || Number(it.quantity) <= 0))
      return toast.error("Every item needs a product and quantity");
    if (!isOT && !isContractor && Object.keys(selectedCards).length === 0)
      return toast.error("Select at least one food item");
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

        {/* GUEST: food item cards with category tabs */}
        {!isOT && !isContractor && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Select food items</label>
              {Object.keys(selectedCards).length > 0 && (
                <button type="button" className="text-xs text-danger underline" onClick={() => setSelectedCards({})}>
                  Clear all
                </button>
              )}
            </div>

            {!foodItems || foodItems.length === 0 ? (
              <p className="text-sm text-muted">No food items found. Add them in Canteen → Food Items.</p>
            ) : (() => {
              // Build category list
              const catMap: Record<string, { id: string; name: string; items: Product[] }> = {};
              for (const p of foodItems) {
                const id = p.categoryId;
                const name = p.category?.name ?? "Other";
                if (!catMap[id]) catMap[id] = { id, name, items: [] };
                catMap[id].items.push(p);
              }
              const categories = Object.values(catMap);
              const visibleItems = activeCategory === "all"
                ? foodItems
                : (catMap[activeCategory]?.items ?? []);

              return (
                <>
                  {/* Category tab pills */}
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    <button
                      type="button"
                      onClick={() => setActiveCategory("all")}
                      className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                        activeCategory === "all"
                          ? "bg-primary text-white"
                          : "bg-gray-100 text-ink hover:bg-gray-200"
                      }`}
                    >
                      All Items
                    </button>
                    {categories.map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setActiveCategory(cat.id)}
                        className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                          activeCategory === cat.id
                            ? "bg-primary text-white"
                            : "bg-gray-100 text-ink hover:bg-gray-200"
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>

                  {/* Item cards grid */}
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                    {visibleItems.map((p) => {
                      const qty = selectedCards[p.id] ?? 0;
                      const selected = qty > 0;
                      const imgUrl = imageSrc(p.imageUrl);
                      return (
                        <div
                          key={p.id}
                          onClick={() => toggleCard(p.id)}
                          className={`cursor-pointer select-none rounded-2xl border-2 overflow-hidden transition-all ${
                            selected ? "border-primary shadow-md" : "border-border hover:border-primary/40 hover:shadow-sm"
                          }`}
                        >
                          {/* Image */}
                          <div className="relative aspect-square w-full bg-gray-100">
                            {imgUrl ? (
                              <img src={imgUrl} alt={p.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-3xl">🍽</div>
                            )}
                            {selected && (
                              <div className="absolute inset-0 bg-primary/10" />
                            )}
                            {selected && (
                              <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white text-xs font-bold shadow">✓</span>
                            )}
                          </div>

                          {/* Info */}
                          <div className="px-2 py-2">
                            <p className={`truncate text-xs font-semibold leading-tight ${selected ? "text-primary" : "text-ink"}`}>
                              {p.name}
                            </p>
                            <p className="mt-0.5 text-xs font-medium text-muted">
                              {p.sellPrice ? `₹${Number(p.sellPrice).toFixed(0)}` : "—"}
                            </p>

                            {/* Qty stepper — shown when selected */}
                            {selected && (
                              <div
                                className="mt-1.5 flex items-center justify-between rounded-lg bg-primary/10 px-1 py-0.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-primary font-bold text-sm shadow-sm border border-primary/30 hover:bg-primary hover:text-white transition-colors"
                                  onClick={() => setCardQty(p.id, qty - 1)}
                                >−</button>
                                <span className="text-xs font-bold text-primary">{qty}</span>
                                <button
                                  type="button"
                                  className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white font-bold text-sm shadow-sm hover:bg-primary/80 transition-colors"
                                  onClick={() => setCardQty(p.id, qty + 1)}
                                >+</button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            {/* Summary bar */}
            {Object.keys(selectedCards).length > 0 && (
              <div className="flex items-center justify-between rounded-xl bg-primary/5 border border-primary/20 px-4 py-2.5">
                <span className="text-sm text-ink">
                  <span className="font-semibold text-primary">{Object.keys(selectedCards).length}</span> item{Object.keys(selectedCards).length !== 1 ? "s" : ""} selected
                </span>
                {estPerPerson > 0 && (
                  <span className="text-sm font-semibold text-ink">
                    {formatCurrency(estPerPerson)} / person
                    {parsedNames.length > 1 && <span className="ml-2 text-muted font-normal">· Total {formatCurrency(estPerPerson * parsedNames.length)}</span>}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* CONTRACTOR: manual dropdown item selection */}
        {isContractor && (
          <div className="space-y-2">
            <label className="label">Food items (same for every person)</label>
            {items.map((it, idx) => (
              <div key={idx} className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
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
                <div className="w-20 flex-shrink-0">
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
                  className="btn-secondary !px-3 flex-shrink-0"
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
          <button className="btn-primary w-full sm:w-auto" type="submit" disabled={placeMutation.isPending}>
            {placeMutation.isPending ? "Placing…" : `Place ${parsedNames.length > 0 ? parsedNames.length : ""} Order(s)`}
          </button>
        </div>
      </form>

      {/* Today's orders */}
      <div>
        <h2 className="mb-2 text-sm font-semibold">Today's orders</h2>

        {/* Mobile cards */}
        <div className="sm:hidden space-y-2">
          {!todaysOrders?.length && (
            <div className="card text-sm text-muted">No orders placed today.</div>
          )}
          {todaysOrders?.map((o) => (
            <div key={o.id} className="card p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{o.dinerName}</p>
                  <p className="text-xs text-muted">{o.orderNo} · {o.orderType} · {o.shift ?? "—"}</p>
                  <p className="text-xs text-muted">{formatDateTime(o.createdAt)}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {o.status === "SERVED"
                    ? <span className="badge-success">Served</span>
                    : <span className="badge-info">Placed</span>}
                  {o.status === "PLACED" ? (
                    <div className="flex gap-1">
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(o)}>Edit</button>
                      <button
                        className="btn-secondary !px-2 !py-1 text-xs text-danger"
                        disabled={deleteMutation.isPending}
                        onClick={() => { if (window.confirm(`Delete order for ${o.dinerName}?`)) deleteMutation.mutate(o.id); }}
                      >Delete</button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">Locked</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table */}
        <div className="hidden sm:block card overflow-x-auto p-0">
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
            {!foodItems || foodItems.length === 0 ? (
              <p className="text-sm text-muted">No food items found.</p>
            ) : (
              (() => {
                const editSelected: Record<string, number> = {};
                editForm.items.forEach((it) => { if (it.productId) editSelected[it.productId] = Number(it.quantity) || 1; });

                function toggleEditCard(productId: string) {
                  const cur = editSelected[productId] ?? 0;
                  const next = cur > 0
                    ? editForm.items.filter((r) => r.productId !== productId)
                    : [...editForm.items, { productId, quantity: "1" }];
                  setEditForm({ ...editForm, items: next });
                }
                function setEditCardQty(productId: string, qty: number) {
                  if (qty <= 0) {
                    setEditForm({ ...editForm, items: editForm.items.filter((r) => r.productId !== productId) });
                  } else {
                    setEditForm({ ...editForm, items: editForm.items.map((r) => r.productId === productId ? { ...r, quantity: String(qty) } : r) });
                  }
                }

                return (
                  <div className="max-h-72 overflow-y-auto pr-1">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {foodItems.map((p) => {
                        const qty = editSelected[p.id] ?? 0;
                        const selected = qty > 0;
                        const imgUrl = imageSrc(p.imageUrl);
                        return (
                          <div
                            key={p.id}
                            onClick={() => toggleEditCard(p.id)}
                            className={`cursor-pointer select-none rounded-xl border-2 overflow-hidden transition-all ${
                              selected ? "border-primary shadow-md" : "border-border hover:border-primary/40"
                            }`}
                          >
                            <div className="relative aspect-square w-full bg-gray-100">
                              {imgUrl ? (
                                <img src={imgUrl} alt={p.name} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-2xl">🍽</div>
                              )}
                              {selected && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white text-[10px] font-bold">✓</span>}
                            </div>
                            <div className="px-1.5 py-1.5">
                              <p className={`truncate text-[11px] font-semibold ${selected ? "text-primary" : "text-ink"}`}>{p.name}</p>
                              <p className="text-[10px] text-muted">{p.sellPrice ? `₹${Number(p.sellPrice).toFixed(0)}` : "—"}</p>
                              {selected && (
                                <div className="mt-1 flex items-center justify-between rounded bg-primary/10 px-0.5 py-0.5" onClick={(e) => e.stopPropagation()}>
                                  <button type="button" className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-primary font-bold text-xs border border-primary/30" onClick={() => setEditCardQty(p.id, qty - 1)}>−</button>
                                  <span className="text-[10px] font-bold text-primary">{qty}</span>
                                  <button type="button" className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white font-bold text-xs" onClick={() => setEditCardQty(p.id, qty + 1)}>+</button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()
            )}
          </div>
          <button className="btn-primary w-full" type="submit" disabled={editMutation.isPending}>
            {editMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
