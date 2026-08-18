import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { formatDateTime } from "../../lib/format";

interface AdjustmentRow {
  id: string;
  area: "STORE" | "CANTEEN";
  quantityDelta: string;
  rate: string;
  valueDelta: string;
  reason: string;
  createdAt: string;
  product: { name: string; unit: { symbol: string } };
  createdBy: { name: string };
}

export function Adjustments() {
  const queryClient = useQueryClient();
  const [area, setArea] = useState<"STORE" | "CANTEEN">("STORE");
  const [productId, setProductId] = useState("");
  const [quantityDelta, setQuantityDelta] = useState("");
  const [reason, setReason] = useState("");

  const { data: adjustments, isLoading } = useQuery({
    queryKey: ["adjustments"],
    queryFn: async () => (await api.get<AdjustmentRow[]>("/canteen/adjustments")).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () =>
      api.post("/canteen/adjustments", { area, productId, quantityDelta: Number(quantityDelta), reason }),
    onSuccess: () => {
      toast.success("Adjustment posted");
      queryClient.invalidateQueries({ queryKey: ["adjustments"] });
      setProductId("");
      setQuantityDelta("");
      setReason("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Stock Adjustments</h1>
        <p className="text-sm text-muted">Authorized corrections only. Every adjustment adds a new ledger entry — history is never edited.</p>
      </div>

      <form
        className="card grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          submitMutation.mutate();
        }}
      >
        <div>
          <label className="label">Area</label>
          <select className="input" value={area} onChange={(e) => setArea(e.target.value as "STORE" | "CANTEEN")}>
            <option value="STORE">Store</option>
            <option value="CANTEEN">Canteen</option>
          </select>
        </div>
        <div>
          <label className="label">Product</label>
          <ProductSelect value={productId} onChange={setProductId} />
        </div>
        <div>
          <label className="label">Quantity (+ / -)</label>
          <input className="input" type="number" step="0.001" required placeholder="e.g. -2 or 5" value={quantityDelta} onChange={(e) => setQuantityDelta(e.target.value)} />
        </div>
        <div className="md:col-span-1">
          <label className="label">Reason</label>
          <input className="input" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Physical count correction" />
        </div>
        <button className="btn-primary" type="submit" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Posting…" : "Post Adjustment"}
        </button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Date</th>
              <th>Area</th>
              <th>Product</th>
              <th>Qty Δ</th>
              <th>Rate</th>
              <th>Value Δ</th>
              <th>Reason</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8}>Loading…</td>
              </tr>
            )}
            {adjustments?.map((a) => (
              <tr key={a.id}>
                <td>{formatDateTime(a.createdAt)}</td>
                <td>{a.area}</td>
                <td>
                  {a.product.name} ({a.product.unit.symbol})
                </td>
                <td className={Number(a.quantityDelta) < 0 ? "text-danger" : "text-success"}>{a.quantityDelta}</td>
                <td>{a.rate}</td>
                <td>{a.valueDelta}</td>
                <td>{a.reason}</td>
                <td>{a.createdBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
