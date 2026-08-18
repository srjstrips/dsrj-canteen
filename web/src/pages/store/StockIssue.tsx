import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { StoreStockRow } from "../../types";
import { formatCurrency, formatDate, formatQty, todayInput } from "../../lib/format";

interface LineItem {
  productId: string;
  quantity: string;
}

interface IssueRow {
  id: string;
  issueNo: string;
  issueDate: string;
  totalValue: string;
  items: { id: string; quantity: string; issueRate: string; issueValue: string; product: { name: string; unit: { symbol: string } } }[];
}

function emptyLine(): LineItem {
  return { productId: "", quantity: "" };
}

export function StockIssue() {
  const queryClient = useQueryClient();
  const [issueDate, setIssueDate] = useState(todayInput());
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const { data: stockRows } = useQuery({
    queryKey: ["store-stock", { from: todayInput(), to: todayInput() }],
    queryFn: async () => (await api.get<StoreStockRow[]>("/store/stock", { params: { from: todayInput(), to: todayInput() } })).data,
  });

  const { data: issues, isLoading } = useQuery({
    queryKey: ["stock-issues"],
    queryFn: async () => (await api.get<IssueRow[]>("/store/stock-issue")).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () =>
      api.post("/store/stock-issue", {
        issueDate,
        items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
      }),
    onSuccess: () => {
      toast.success("Stock issued to Canteen");
      queryClient.invalidateQueries({ queryKey: ["stock-issues"] });
      queryClient.invalidateQueries({ queryKey: ["store-stock"] });
      setLines([emptyLine()]);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function balanceFor(productId: string): StoreStockRow | undefined {
    return stockRows?.find((r) => r.productId === productId);
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
        <h1 className="text-xl font-bold">Stock Issue to Canteen</h1>
        <p className="text-sm text-muted">Select the product and enter only the issue quantity — the current average rate is applied automatically.</p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <div className="max-w-xs">
          <label className="label">Date</label>
          <input className="input" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </div>

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
                    <label className="label">Issue Quantity</label>
                    <input className="input" type="number" min={0} step="0.001" required value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Current Avg Rate</label>
                    <div className="input bg-background">{balance ? formatCurrency(balance.avgRate) : "—"}</div>
                  </div>
                  <div>
                    <label className="label">Issue Value</label>
                    <div className="input bg-background font-medium">{formatCurrency(projectedValue)}</div>
                  </div>
                  <button type="button" className="btn-secondary !px-2 !py-2 text-xs" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                    Remove
                  </button>
                </div>
                {balance && (
                  <p className={`mt-1 text-xs ${overLimit ? "text-danger font-semibold" : "text-muted"}`}>
                    Available quantity: {formatQty(balance.balanceQty)} {balance.unit}
                    {overLimit && " — exceeds available stock"}
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
            {submitMutation.isPending ? "Issuing…" : "Issue to Canteen"}
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <h2 className="p-4 pb-0 font-semibold">Recent Issues</h2>
        <table className="table-base mt-2">
          <thead>
            <tr>
              <th>Issue No.</th>
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
            {issues?.map((issue) => (
              <tr key={issue.id}>
                <td className="font-medium">{issue.issueNo}</td>
                <td>{formatDate(issue.issueDate)}</td>
                <td>{issue.items.map((it) => `${it.product.name} (${it.quantity} ${it.product.unit.symbol} @ ₹${it.issueRate})`).join(", ")}</td>
                <td>{formatCurrency(issue.totalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
