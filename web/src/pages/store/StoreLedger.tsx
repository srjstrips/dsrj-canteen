import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { ProductSelect } from "../../components/ProductSelect";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { formatCurrency, formatDateTime, formatQty, startOfMonthInput, todayInput } from "../../lib/format";

interface LedgerRow {
  id: string;
  txnDate: string;
  txnType: "OPENING" | "INWARD" | "ISSUE" | "ADJUSTMENT";
  inwardQty: string;
  issueQty: string;
  rate: string;
  balanceQty: string;
  balanceValue: string;
  remarks?: string;
}

export function StoreLedger() {
  const [productId, setProductId] = useState("");
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["store-ledger", productId, range],
    queryFn: async () => (await api.get<LedgerRow[]>(`/store/ledger/${productId}`, { params: range })).data,
    enabled: !!productId,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Stock Ledger</h1>
        <p className="text-sm text-muted">Complete, append-only movement history for a product — nothing here is ever overwritten.</p>
      </div>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="label">Product</label>
          <ProductSelect value={productId} onChange={setProductId} />
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Date</th>
              <th>Transaction</th>
              <th className="text-right">Inward</th>
              <th className="text-right">Issue</th>
              <th className="text-right">Balance Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Stock Value</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {!productId && (
              <tr>
                <td colSpan={8} className="text-muted">
                  Select a product to view its ledger.
                </td>
              </tr>
            )}
            {isLoading && (
              <tr>
                <td colSpan={8}>Loading…</td>
              </tr>
            )}
            {rows?.map((r) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.txnDate)}</td>
                <td>
                  <span className={r.txnType === "INWARD" ? "text-success font-medium" : r.txnType === "ISSUE" ? "text-danger font-medium" : "font-medium"}>{r.txnType}</span>
                </td>
                <td className="text-right">{Number(r.inwardQty) > 0 ? formatQty(r.inwardQty) : "—"}</td>
                <td className="text-right">{Number(r.issueQty) > 0 ? formatQty(r.issueQty) : "—"}</td>
                <td className="text-right font-semibold">{formatQty(r.balanceQty)}</td>
                <td className="text-right">{formatCurrency(r.rate)}</td>
                <td className="text-right">{formatCurrency(r.balanceValue)}</td>
                <td className="text-muted">{r.remarks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
