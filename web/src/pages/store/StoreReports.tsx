import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { ExcelButton } from "../../components/ExcelButton";
import { formatCurrency, formatQty, startOfMonthInput, todayInput } from "../../lib/format";

type ReportKey = "purchase-value" | "supplier-wise-purchase" | "average-rate" | "low-stock";

const tabs: { key: ReportKey; label: string }[] = [
  { key: "purchase-value", label: "Purchase Value" },
  { key: "supplier-wise-purchase", label: "Supplier-wise Purchase" },
  { key: "average-rate", label: "Average Rate" },
  { key: "low-stock", label: "Low Stock" },
];

export function StoreReports() {
  const [tab, setTab] = useState<ReportKey>("purchase-value");
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data, isLoading } = useQuery({
    queryKey: ["store-report", tab, range],
    queryFn: async () => (await api.get(`/reports/store/${tab}`, { params: range })).data,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Store Reports</h1>
        <p className="text-sm text-muted">Purchases, average rate and low-stock analysis</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={t.key === tab ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {tab !== "average-rate" && tab !== "low-stock" && <DateRangeFilter value={range} onChange={setRange} />}
          <ExcelButton filename={`store-${tab}`} rows={data as Record<string, unknown>[] | undefined} />
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        {isLoading && <p className="p-4 text-muted">Loading…</p>}

        {tab === "purchase-value" && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>Unit</th>
                <th className="text-right">Quantity Purchased</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: { productId: string; productName: string; unit: string; quantity: string; value: string }) => (
                <tr key={r.productId}>
                  <td>{r.productName}</td>
                  <td>{r.unit}</td>
                  <td className="text-right">{formatQty(r.quantity)}</td>
                  <td className="text-right">{formatCurrency(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "supplier-wise-purchase" && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Supplier</th>
                <th className="text-right">Invoices</th>
                <th className="text-right">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: { supplierId: string; supplierName: string; invoiceCount: number; totalValue: string }) => (
                <tr key={r.supplierId}>
                  <td>{r.supplierName}</td>
                  <td className="text-right">{r.invoiceCount}</td>
                  <td className="text-right">{formatCurrency(r.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "average-rate" && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Avg Rate</th>
                <th className="text-right">Stock Value</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: { productId: string; productName: string; category: string; unit: string; quantity: string; avgRate: string; stockValue: string }) => (
                <tr key={r.productId}>
                  <td>{r.productName}</td>
                  <td>{r.category}</td>
                  <td>{r.unit}</td>
                  <td className="text-right">{formatQty(r.quantity)}</td>
                  <td className="text-right">{formatCurrency(r.avgRate)}</td>
                  <td className="text-right">{formatCurrency(r.stockValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "low-stock" && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Unit</th>
                <th className="text-right">Store Qty</th>
                <th className="text-right">Canteen Qty</th>
                <th className="text-right">Min Stock Level</th>
                <th className="text-right">Reorder Level</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: { productId: string; productName: string; category: string; unit: string; storeQty: string; canteenQty: string; minStockLevel: string; reorderLevel: string }) => (
                <tr key={r.productId} className="bg-danger-light/40">
                  <td className="font-medium">{r.productName}</td>
                  <td>{r.category}</td>
                  <td>{r.unit}</td>
                  <td className="text-right text-danger">{formatQty(r.storeQty)}</td>
                  <td className="text-right text-danger">{formatQty(r.canteenQty)}</td>
                  <td className="text-right">{formatQty(r.minStockLevel)}</td>
                  <td className="text-right">{formatQty(r.reorderLevel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
