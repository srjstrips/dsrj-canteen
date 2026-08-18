import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { StatCard } from "../../components/StatCard";
import { formatCurrency, formatQty } from "../../lib/format";

interface CanteenDashboardData {
  todaysSales: number;
  totalBills: number;
  canteenStockValue: number;
  todaysWastageValue: number;
  todaysConsumptionQty: number;
  lowStockCount: number;
  topSellingProducts: { productId: string; name: string; quantity: string; amount: string }[];
}

export function CanteenDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["canteen-dashboard"],
    queryFn: async () => (await api.get<CanteenDashboardData>("/canteen/dashboard")).data,
  });

  if (isLoading || !data) return <div className="text-muted">Loading dashboard…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Canteen Dashboard</h1>
        <p className="text-sm text-muted">Today's sales & stock overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today's Sales" value={formatCurrency(data.todaysSales)} tone="success" />
        <StatCard label="Total Bills" value={data.totalBills} />
        <StatCard label="Canteen Stock Value" value={formatCurrency(data.canteenStockValue)} />
        <StatCard label="Today's Wastage" value={formatCurrency(data.todaysWastageValue)} tone="danger" />
        <StatCard label="Today's Consumption" value={`${formatQty(data.todaysConsumptionQty)} units`} />
        <StatCard label="Low Stock Items" value={data.lowStockCount} tone={data.lowStockCount > 0 ? "danger" : "default"} />
      </div>

      <div className="card">
        <h2 className="mb-3 font-semibold">Top Selling Products (Today)</h2>
        <table className="table-base">
          <thead>
            <tr>
              <th>Product</th>
              <th className="text-right">Qty Sold</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.topSellingProducts.map((p) => (
              <tr key={p.productId}>
                <td>{p.name}</td>
                <td className="text-right">{formatQty(p.quantity)}</td>
                <td className="text-right">{formatCurrency(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
