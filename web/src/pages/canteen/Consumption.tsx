import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { formatCurrency, formatDateTime, formatQty, startOfMonthInput, todayInput } from "../../lib/format";

interface ConsumptionRow {
  id: string;
  txnDate: string;
  outQty: string;
  rate: string;
  balanceValue: string;
  remarks?: string;
  product: { name: string; unit: { symbol: string }; category: { name: string } };
}

export function Consumption() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["consumption", range],
    queryFn: async () => (await api.get<ConsumptionRow[]>("/reports/canteen/consumption", { params: range })).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () => api.post("/canteen/consumption", { productId, quantity: Number(quantity), notes: notes || undefined }),
    onSuccess: () => {
      toast.success("Consumption recorded");
      queryClient.invalidateQueries({ queryKey: ["consumption"] });
      queryClient.invalidateQueries({ queryKey: ["canteen-stock"] });
      setProductId("");
      setQuantity("");
      setNotes("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!productId) return toast.error("Product is required");
    if (Number(quantity) <= 0) return toast.error("Quantity must be greater than 0");
    submitMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Consumption</h1>
        <p className="text-sm text-muted">Record ingredient usage for food preparation. Rate & value are computed automatically.</p>
      </div>

      <form onSubmit={submit} className="card grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
        <div>
          <label className="label">Product</label>
          <ProductSelect value={productId} onChange={setProductId} />
        </div>
        <div>
          <label className="label">Quantity</label>
          <input className="input" type="number" min={0} step="0.001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Used for lunch prep" />
        </div>
        <button className="btn-primary" type="submit" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Saving…" : "Record Consumption"}
        </button>
      </form>

      <div className="flex justify-end">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Category</th>
              <th className="text-right">Quantity</th>
              <th className="text-right">Rate</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.txnDate)}</td>
                <td>{r.product.name}</td>
                <td>{r.product.category.name}</td>
                <td className="text-right">
                  {formatQty(r.outQty)} {r.product.unit.symbol}
                </td>
                <td className="text-right">{formatCurrency(r.rate)}</td>
                <td className="text-muted">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
