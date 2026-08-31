import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { BulkImport } from "../../components/BulkImport";
import { CanteenStockRow } from "../../types";
import { formatCurrency, formatDate, formatQty, todayInput } from "../../lib/format";

interface LineItem {
  productId: string;
  quantity: string;
}

interface ReturnRow {
  id: string;
  returnNo: string;
  returnDate: string;
  totalValue: string;
  items: { id: string; quantity: string; returnRate: string; returnValue: string; product: { name: string; unit: { symbol: string } } }[];
}

function emptyLine(): LineItem {
  return { productId: "", quantity: "" };
}

export function StoreReturn() {
  const queryClient = useQueryClient();
  const [returnDate, setReturnDate] = useState(todayInput());
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const { data: canteenRows } = useQuery({
    queryKey: ["canteen-stock", { from: todayInput(), to: todayInput() }],
    queryFn: async () => (await api.get<CanteenStockRow[]>("/canteen/stock", { params: { from: todayInput(), to: todayInput() } })).data,
  });

  const { data: returns, isLoading } = useQuery({
    queryKey: ["stock-returns"],
    queryFn: async () => (await api.get<ReturnRow[]>("/store/stock-return")).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () =>
      api.post("/store/stock-return", {
        returnDate,
        items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
      }),
    onSuccess: () => {
      toast.success("Stock returned to Store");
      queryClient.invalidateQueries({ queryKey: ["stock-returns"] });
      queryClient.invalidateQueries({ queryKey: ["store-stock"] });
      queryClient.invalidateQueries({ queryKey: ["canteen-stock"] });
      setLines([emptyLine()]);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function importReturn(file: File) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("returnDate", returnDate);
    const res = await api.post<{ importedRows: number }>("/store/stock-return/import", formData);
    queryClient.invalidateQueries({ queryKey: ["stock-returns"] });
    queryClient.invalidateQueries({ queryKey: ["store-stock"] });
    queryClient.invalidateQueries({ queryKey: ["canteen-stock"] });
    return res.data;
  }

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function balanceFor(productId: string): CanteenStockRow | undefined {
    return canteenRows?.find((r) => r.productId === productId);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (lines.some((l) => !l.productId)) return toast.error("Product is required for every line");
    if (lines.some((l) => Number(l.quantity) <= 0)) return toast.error("Quantity must be greater than 0");
    submitMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Return Stock to Store</h1>
        <p className="text-sm text-muted">
          Return unused canteen stock back to the store (month-end). Canteen stock decreases and store stock increases at the canteen average rate.
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <div className="max-w-xs">
          <label className="label">Date</label>
          <input className="input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
        </div>

        <BulkImport
          templateUrl="/store/stock-return/template"
          templateFilename="stock-return-template.xlsx"
          hint="Download the template (shows current canteen quantity), fill Return Quantity, then upload."
          onImport={importReturn}
        />

        <div className="space-y-2">
          {lines.map((line, i) => {
            const balance = balanceFor(line.productId);
            const qty = Number(line.quantity) || 0;
            const projectedValue = balance ? qty * Number(balance.avgRate) : 0;
            const overLimit = balance ? qty > Number(balance.balanceQty) : false;
            return (
              <div key={i} className="rounded-lg border border-border p-3">
                <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                  <div>
                    <label className="label">Product</label>
                    <ProductSelect value={line.productId} onChange={(productId) => updateLine(i, { productId })} />
                  </div>
                  <div>
                    <label className="label">Return Quantity</label>
                    <input className="input" type="number" min={0} step="0.001" required value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Canteen Avg Rate</label>
                    <div className="input bg-background">{balance ? formatCurrency(balance.avgRate) : "—"}</div>
                  </div>
                  <div>
                    <label className="label">Return Value</label>
                    <div className="input bg-background font-medium">{formatCurrency(projectedValue)}</div>
                  </div>
                  <button type="button" className="btn-secondary !px-2 !py-2 text-xs" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                    Remove
                  </button>
                </div>
                {balance && (
                  <p className={`mt-1 text-xs ${overLimit ? "text-danger font-semibold" : "text-muted"}`}>
                    Canteen quantity available: {formatQty(balance.balanceQty)} {balance.unit}
                    {overLimit && " — exceeds canteen stock"}
                  </p>
                )}
              </div>
            );
          })}
          <button type="button" className="btn-secondary text-xs" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            + Add Line
          </button>
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <button className="btn-primary" type="submit" disabled={submitMutation.isPending}>
            {submitMutation.isPending ? "Returning…" : "Return to Store"}
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <h2 className="p-4 pb-0 font-semibold">Recent Returns</h2>
        <table className="table-base mt-2">
          <thead>
            <tr>
              <th>Return No.</th>
              <th>Date</th>
              <th>Items</th>
              <th>Total Value</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4}>Loading…</td>
              </tr>
            )}
            {returns?.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.returnNo}</td>
                <td>{formatDate(r.returnDate)}</td>
                <td>{r.items.map((it) => `${it.product.name} (${it.quantity} ${it.product.unit.symbol} @ ₹${it.returnRate})`).join(", ")}</td>
                <td>{formatCurrency(r.totalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
