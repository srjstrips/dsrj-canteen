import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { formatCurrency, formatDateTime, formatQty, startOfMonthInput, todayInput } from "../../lib/format";

const reasons = ["SPOILAGE", "EXPIRED", "PREPARATION_WASTE", "DAMAGED", "EXCESS_PREPARATION", "OTHER"] as const;

interface WastageRow {
  id: string;
  wastageDate: string;
  quantity: string;
  rate: string;
  wastageValue: string;
  reason: string;
  notes?: string;
  product: { name: string; unit: { symbol: string }; category: { name: string } };
  createdBy: { name: string };
}

export function Wastage() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState<(typeof reasons)[number]>("SPOILAGE");
  const [notes, setNotes] = useState("");
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["wastage", range],
    queryFn: async () => (await api.get<WastageRow[]>("/canteen/wastage", { params: range })).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () => api.post("/canteen/wastage", { productId, quantity: Number(quantity), reason, notes: notes || undefined }),
    onSuccess: () => {
      toast.success("Wastage recorded");
      queryClient.invalidateQueries({ queryKey: ["wastage"] });
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

  const totalWastageValue = rows?.reduce((sum, r) => sum + Number(r.wastageValue), 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Wastage</h1>
        <p className="text-sm text-muted">Record spoilage, expiry, or preparation waste. Rate & value are computed automatically.</p>
      </div>

      <form onSubmit={submit} className="card grid grid-cols-1 gap-3 md:grid-cols-5 md:items-end">
        <div>
          <label className="label">Product</label>
          <ProductSelect value={productId} onChange={setProductId} />
        </div>
        <div>
          <label className="label">Quantity</label>
          <input className="input" type="number" min={0} step="0.001" required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className="label">Reason</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <button className="btn-primary" type="submit" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Saving…" : "Record Wastage"}
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-danger">Total wastage value (range): {formatCurrency(totalWastageValue)}</p>
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
              <th className="text-right">Wastage Value</th>
              <th>Reason</th>
              <th>Entered By</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8}>Loading…</td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.wastageDate)}</td>
                <td>{r.product.name}</td>
                <td>{r.product.category.name}</td>
                <td className="text-right">
                  {formatQty(r.quantity)} {r.product.unit.symbol}
                </td>
                <td className="text-right">{formatCurrency(r.rate)}</td>
                <td className="text-right text-danger">{formatCurrency(r.wastageValue)}</td>
                <td>{r.reason.replaceAll("_", " ")}</td>
                <td>{r.createdBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
