import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { formatCurrency, formatDateTime, formatQty, startOfMonthInput, todayInput } from "../../lib/format";

interface ReceivedRow {
  id: string;
  txnDate: string;
  inQty: string;
  rate: string;
  balanceQty: string;
  balanceValue: string;
  remarks?: string;
  product: { name: string; unit: { symbol: string }; category: { name: string } };
}

export function ReceivedStock() {
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["received-stock", range],
    queryFn: async () => (await api.get<ReceivedRow[]>("/canteen/received-stock", { params: range })).data,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Received Stock</h1>
          <p className="text-sm text-muted">Stock issued by Store — read-only, cannot be edited here</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Date</th>
              <th>Product</th>
              <th>Category</th>
              <th className="text-right">Received Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Value</th>
              <th>Reference</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7}>Loading…</td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.txnDate)}</td>
                <td className="font-medium">{r.product.name}</td>
                <td>{r.product.category.name}</td>
                <td className="text-right text-success">
                  {formatQty(r.inQty)} {r.product.unit.symbol}
                </td>
                <td className="text-right">{formatCurrency(r.rate)}</td>
                <td className="text-right">{formatCurrency(Number(r.inQty) * Number(r.rate))}</td>
                <td className="text-muted">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
