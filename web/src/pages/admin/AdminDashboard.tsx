import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { StatCard } from "../../components/StatCard";
import { formatCurrency } from "../../lib/format";

interface AdminDashboardData {
  storeStockValue: number;
  canteenStockValue: number;
  todaysSales: number;
  monthlySales: number;
  monthlyPurchases: number;
  monthlyWastageValue: number;
  activeProducts: number;
  activeUsers: number;
}

export function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => (await api.get<AdminDashboardData>("/dashboard/admin")).data,
  });

  if (isLoading || !data) return <div className="text-muted">Loading dashboard…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Admin Dashboard</h1>
        <p className="text-sm text-muted">Overall summary across Store and Canteen</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Store Stock Value" value={formatCurrency(data.storeStockValue)} />
        <StatCard label="Canteen Stock Value" value={formatCurrency(data.canteenStockValue)} />
        <StatCard label="Today's Sales" value={formatCurrency(data.todaysSales)} tone="success" />
        <StatCard label="Monthly Sales" value={formatCurrency(data.monthlySales)} tone="success" />
        <StatCard label="Monthly Purchases" value={formatCurrency(data.monthlyPurchases)} />
        <StatCard label="Monthly Wastage" value={formatCurrency(data.monthlyWastageValue)} tone="danger" />
        <StatCard label="Active Products" value={data.activeProducts} />
        <StatCard label="Active Users" value={data.activeUsers} />
      </div>
    </div>
  );
}
