import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import { StatCard } from "../../components/StatCard";
import { formatCurrency, formatQty, todayInput } from "../../lib/format";

interface DailySalesData {
  totalBills: number;
  totalSales: string;
  cashSales: string;
  upiSales: string;
  creditSales: string;
  productWiseSales: { productId: string; name: string; qty: string; amount: string }[];
}

export function DailySales() {
  const [range, setRange] = useState({ from: todayInput(), to: todayInput() });

  const { data, isLoading } = useQuery({
    queryKey: ["daily-sales", range],
    queryFn: async () => (await api.get<DailySalesData>("/canteen/sales/daily-summary", { params: range })).data,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Daily Sales</h1>
          <p className="text-sm text-muted">Bills, payment mode split and product-wise sales</p>
        </div>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {isLoading || !data ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Bills" value={data.totalBills} />
            <StatCard label="Total Sales" value={formatCurrency(data.totalSales)} tone="success" />
            <StatCard label="Cash Sales" value={formatCurrency(data.cashSales)} />
            <StatCard label="UPI Sales" value={formatCurrency(data.upiSales)} />
            <StatCard label="Credit Sales" value={formatCurrency(data.creditSales)} />
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold">Product-wise Sales</h2>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Quantity Sold</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.productWiseSales.map((p) => (
                  <tr key={p.productId}>
                    <td>{p.name}</td>
                    <td className="text-right">{formatQty(p.qty)}</td>
                    <td className="text-right">{formatCurrency(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
