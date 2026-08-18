import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { StoreStockRow } from "../../types";
import { formatCurrency, formatQty, todayInput } from "../../lib/format";

export function StoreStock() {
  const [range, setRange] = useState({ from: todayInput(), to: todayInput() });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["store-stock", range],
    queryFn: async () => (await api.get<StoreStockRow[]>("/store/stock", { params: range })).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Store Stock</h1>
          <p className="text-sm text-muted">Opening / Inward / Available / Issue / Balance — computed automatically from the ledger</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Product</th>
              <th>Unit</th>
              <th className="text-right">Opening Qty</th>
              <th className="text-right">Inward Qty</th>
              <th className="text-right">Available Qty</th>
              <th className="text-right">Avg Rate</th>
              <th className="text-right">Issue Qty</th>
              <th className="text-right">Balance Qty</th>
              <th className="text-right">Stock Value</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9}>Loading…</td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.productId} className={r.isLowStock ? "bg-danger-light/40" : undefined}>
                <td className="font-medium">
                  {r.productName}
                  {r.isLowStock && <span className="badge-danger ml-2">Low Stock</span>}
                </td>
                <td>{r.unit}</td>
                <td className="text-right">{formatQty(r.openingQty)}</td>
                <td className="text-right text-success">{formatQty(r.inwardQty)}</td>
                <td className="text-right">{formatQty(r.availableQty)}</td>
                <td className="text-right">{formatCurrency(r.avgRate)}</td>
                <td className="text-right">{formatQty(r.issueQty)}</td>
                <td className={`text-right font-semibold ${r.isLowStock ? "text-danger" : "text-success"}`}>{formatQty(r.balanceQty)}</td>
                <td className="text-right">{formatCurrency(r.stockValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
