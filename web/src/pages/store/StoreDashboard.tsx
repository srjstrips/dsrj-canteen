import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { StatCard } from "../../components/StatCard";
import { formatCurrency, formatDate, formatQty } from "../../lib/format";

interface StoreDashboardData {
  totalStockValue: number;
  totalProducts: number;
  todaysInwardQty: number;
  todaysInwardValue: number;
  todaysIssueQty: number;
  todaysIssueValue: number;
  lowStockCount: number;
  recentInwards: { id: string; inwardNo: string; inwardDate: string; totalValue: string; supplier: { name: string } }[];
  recentIssues: { id: string; issueNo: string; issueDate: string; totalValue: string }[];
}

export function StoreDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["store-dashboard"],
    queryFn: async () => (await api.get<StoreDashboardData>("/store/dashboard")).data,
  });

  if (isLoading || !data) return <div className="text-muted">Loading dashboard…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Store Dashboard</h1>
        <p className="text-sm text-muted">Supplier → Store stock overview</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Stock Value" value={formatCurrency(data.totalStockValue)} />
        <StatCard label="Total Products" value={data.totalProducts} />
        <StatCard label="Today's Inward" value={`${formatQty(data.todaysInwardQty)} units`} hint={formatCurrency(data.todaysInwardValue)} tone="success" />
        <StatCard label="Today's Issue" value={`${formatQty(data.todaysIssueQty)} units`} hint={formatCurrency(data.todaysIssueValue)} />
        <StatCard label="Low Stock Products" value={data.lowStockCount} tone={data.lowStockCount > 0 ? "danger" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-semibold">Recent Inward Entries</h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.recentInwards.map((r) => (
                <tr key={r.id}>
                  <td>{r.inwardNo}</td>
                  <td>{formatDate(r.inwardDate)}</td>
                  <td>{r.supplier.name}</td>
                  <td>{formatCurrency(r.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="mb-3 font-semibold">Recent Issues</h2>
          <table className="table-base">
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {data.recentIssues.map((r) => (
                <tr key={r.id}>
                  <td>{r.issueNo}</td>
                  <td>{formatDate(r.issueDate)}</td>
                  <td>{formatCurrency(r.totalValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
