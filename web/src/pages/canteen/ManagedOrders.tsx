import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { Modal } from "../../components/Modal";
import { formatCurrency, formatQty } from "../../lib/format";
import { ManagedOrder } from "../../types";

interface ExtraRow {
  productId: string;
  quantity: string;
}

export function ManagedOrders() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [extrasFor, setExtrasFor] = useState<ManagedOrder | null>(null);
  const [extras, setExtras] = useState<ExtraRow[]>([{ productId: "", quantity: "1" }]);

  const { data: orders, isLoading } = useQuery({
    queryKey: ["managed-orders", "canteen"],
    queryFn: async () => (await api.get<ManagedOrder[]>("/managed/orders")).data,
    refetchInterval: 15000,
  });

  const serve = useMutation({
    mutationFn: async (id: string) => api.post(`/managed/orders/${id}/serve`),
    onSuccess: () => {
      toast.success("Order served");
      queryClient.invalidateQueries({ queryKey: ["managed-orders"] });
      queryClient.invalidateQueries({ queryKey: ["canteen-stock"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const addExtras = useMutation({
    mutationFn: async () =>
      api.post(`/managed/orders/${extrasFor!.id}/extras`, {
        items: extras.map((r) => ({ productId: r.productId, quantity: Number(r.quantity) })),
      }),
    onSuccess: () => {
      toast.success("Extras sent for HOD confirmation");
      queryClient.invalidateQueries({ queryKey: ["managed-orders"] });
      setExtrasFor(null);
      setExtras([{ productId: "", quantity: "1" }]);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const filtered = orders?.filter((o) => o.dinerName.toLowerCase().includes(search.trim().toLowerCase())) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">OT / Guest / Contractor Orders</h1>
        <p className="text-sm text-muted">Find the diner by name, serve their order, and record any extra food eaten.</p>
      </div>

      <input className="input max-w-sm" placeholder="Search diner name…" value={search} onChange={(e) => setSearch(e.target.value)} />

      {isLoading && <p className="text-muted">Loading…</p>}

      <div className="space-y-3">
        {filtered.length === 0 && !isLoading && <p className="card text-muted">No orders found.</p>}
        {filtered.map((o) => (
          <div key={o.id} className="card space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {o.dinerName} <span className="text-muted">· {o.orderNo}</span>
                </p>
                <p className="text-xs text-muted">
                  {o.orderType} · {o.account.name} {o.shift ? `· ${o.shift}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {o.status === "SERVED" ? <span className="badge-success">Served</span> : <span className="badge-info">Placed</span>}
                {o.status === "PLACED" && (
                  <button className="btn-primary !py-1.5 text-xs" disabled={serve.isPending} onClick={() => serve.mutate(o.id)}>
                    Serve Food
                  </button>
                )}
                {o.status === "SERVED" && (
                  <button
                    className="btn-secondary !py-1.5 text-xs"
                    onClick={() => {
                      setExtrasFor(o);
                      setExtras([{ productId: "", quantity: "1" }]);
                    }}
                  >
                    + Add Extra Items
                  </button>
                )}
              </div>
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Amount</th>
                  <th>Kind</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.product.name}</td>
                    <td className="text-right">
                      {formatQty(i.quantity)} {i.product.unit.symbol}
                    </td>
                    <td className="text-right">{formatCurrency(i.amount)}</td>
                    <td>
                      {!i.isExtra ? (
                        <span className="text-muted">Standard</span>
                      ) : i.extraStatus === "PENDING" ? (
                        <span className="badge-warning">Extra · pending</span>
                      ) : i.extraStatus === "CONFIRMED" ? (
                        <span className="badge-success">Extra · confirmed</span>
                      ) : (
                        <span className="badge-danger">Extra · rejected</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <Modal open={!!extrasFor} onClose={() => setExtrasFor(null)} title={`Add extras — ${extrasFor?.dinerName ?? ""}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (extras.some((r) => !r.productId || Number(r.quantity) <= 0)) return toast.error("Every extra needs a product and quantity");
            addExtras.mutate();
          }}
        >
          {extras.map((r, idx) => (
            <div key={idx} className="flex items-end gap-2">
              <div className="flex-1">
                <ProductSelect sellableOnly value={r.productId} onChange={(v) => setExtras(extras.map((x, i) => (i === idx ? { ...x, productId: v } : x)))} />
              </div>
              <div className="w-24">
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="0.001"
                  value={r.quantity}
                  onChange={(e) => setExtras(extras.map((x, i) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                />
              </div>
              <button
                type="button"
                className="btn-secondary !px-3"
                onClick={() => setExtras(extras.length === 1 ? [{ productId: "", quantity: "1" }] : extras.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setExtras([...extras, { productId: "", quantity: "1" }])}>
            + Add another
          </button>
          <button className="btn-primary w-full" type="submit" disabled={addExtras.isPending}>
            {addExtras.isPending ? "Sending…" : "Send for HOD confirmation"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
