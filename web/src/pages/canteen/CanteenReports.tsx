import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { ExcelButton } from "../../components/ExcelButton";
import { formatCurrency, formatQty, startOfMonthInput, todayInput } from "../../lib/format";

type ReportKey = "monthly-sales" | "payment-mode" | "wastage";

const tabs: { key: ReportKey; label: string }[] = [
  { key: "monthly-sales", label: "Monthly Sales" },
  { key: "payment-mode", label: "Payment Mode" },
  { key: "wastage", label: "Wastage" },
];

export function CanteenReports() {
  const [tab, setTab] = useState<ReportKey>("payment-mode");
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data, isLoading } = useQuery({
    queryKey: ["canteen-report", tab, range],
    queryFn: async () => (await api.get(`/reports/canteen/${tab}`, { params: range })).data,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Canteen Reports</h1>
        <p className="text-sm text-muted">Sales, payment mode split and wastage cost</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.key} className={t.key === tab ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter value={range} onChange={setRange} />
          <ExcelButton
            filename={`canteen-${tab}`}
            rows={
              tab === "monthly-sales"
                ? ((data as { productWiseSales?: Record<string, unknown>[] } | undefined)?.productWiseSales)
                : (data as Record<string, unknown>[] | undefined)
            }
          />
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        {isLoading && <p className="p-4 text-muted">Loading…</p>}

        {tab === "monthly-sales" && data && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Total Bills</td>
                <td className="text-right">{data.totalBills}</td>
              </tr>
              <tr>
                <td>Total Sales</td>
                <td className="text-right">{formatCurrency(data.totalSales)}</td>
              </tr>
              <tr>
                <td>Cash Sales</td>
                <td className="text-right">{formatCurrency(data.cashSales)}</td>
              </tr>
              <tr>
                <td>UPI Sales</td>
                <td className="text-right">{formatCurrency(data.upiSales)}</td>
              </tr>
              <tr>
                <td>Credit Sales</td>
                <td className="text-right">{formatCurrency(data.creditSales)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {tab === "payment-mode" && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Payment Mode</th>
                <th className="text-right">Bill Count</th>
                <th className="text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: { paymentMode: string; billCount: number; totalAmount: string }) => (
                <tr key={r.paymentMode}>
                  <td>{r.paymentMode}</td>
                  <td className="text-right">{r.billCount}</td>
                  <td className="text-right">{formatCurrency(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "wastage" && (
          <table className="table-base">
            <thead>
              <tr>
                <th>Reason</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: { reason: string; quantity: string; value: string }) => (
                <tr key={r.reason}>
                  <td>{r.reason.replaceAll("_", " ")}</td>
                  <td className="text-right">{formatQty(r.quantity)}</td>
                  <td className="text-right">{formatCurrency(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
