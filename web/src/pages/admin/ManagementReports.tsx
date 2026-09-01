import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { ExcelButton } from "../../components/ExcelButton";
import { StatCard } from "../../components/StatCard";
import { formatCurrency, startOfMonthInput, todayInput } from "../../lib/format";

export function ManagementReports() {
  const [range, setRange] = useState({ from: startOfMonthInput(), to: todayInput() });

  const { data: purchaseVsSales } = useQuery({
    queryKey: ["mgmt-purchase-vs-sales", range],
    queryFn: async () => (await api.get("/reports/management/purchase-vs-sales", { params: range })).data,
  });
  const { data: stockValue } = useQuery({
    queryKey: ["mgmt-stock-value"],
    queryFn: async () => (await api.get("/reports/management/stock-value")).data,
  });
  const { data: foodCost } = useQuery({
    queryKey: ["mgmt-food-cost", range],
    queryFn: async () => (await api.get("/reports/management/food-cost", { params: range })).data,
  });
  const { data: wastageCost } = useQuery({
    queryKey: ["mgmt-wastage-cost", range],
    queryFn: async () => (await api.get("/reports/management/wastage-cost", { params: range })).data,
  });

  const totalWastage = (wastageCost ?? []).reduce((sum: number, w: { value: string }) => sum + Number(w.value), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Management Reports</h1>
          <p className="text-sm text-muted">Cross-module performance summary</p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangeFilter value={range} onChange={setRange} />
          <ExcelButton
            filename="management-summary"
            rows={[
              {
                Purchases: Number(purchaseVsSales?.totalPurchaseValue ?? 0),
                Sales: Number(purchaseVsSales?.totalSalesValue ?? 0),
                "Store Stock Value": Number(stockValue?.storeStockValue ?? 0),
                "Canteen Stock Value": Number(stockValue?.canteenStockValue ?? 0),
                "Food Cost (COGS)": Number(foodCost?.costOfGoods ?? 0),
                "Food Cost %": Number(foodCost?.foodCostPct ?? 0),
                "Wastage Cost": totalWastage,
              },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Purchases (range)" value={formatCurrency(purchaseVsSales?.totalPurchaseValue)} />
        <StatCard label="Sales (range)" value={formatCurrency(purchaseVsSales?.totalSalesValue)} tone="success" />
        <StatCard label="Store Stock Value" value={formatCurrency(stockValue?.storeStockValue)} />
        <StatCard label="Canteen Stock Value" value={formatCurrency(stockValue?.canteenStockValue)} />
        <StatCard label="Food Cost (COGS)" value={formatCurrency(foodCost?.costOfGoods)} />
        <StatCard label="Food Cost %" value={`${Number(foodCost?.foodCostPct ?? 0).toFixed(1)}%`} />
        <StatCard label="Wastage Cost (range)" value={formatCurrency(totalWastage)} tone="danger" />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Wastage by Reason</h2>
        <ExcelButton filename="management-wastage" rows={wastageCost as Record<string, unknown>[] | undefined} />
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Wastage Reason</th>
              <th>Quantity</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {wastageCost?.map((w: { reason: string; quantity: string; value: string }) => (
              <tr key={w.reason}>
                <td>{w.reason.replaceAll("_", " ")}</td>
                <td>{w.quantity}</td>
                <td>{formatCurrency(w.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
