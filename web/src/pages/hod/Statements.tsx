import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useBillingAccounts } from "../../api/queries";
import { Combobox } from "../../components/Combobox";
import { formatCurrency, formatDate, formatQty } from "../../lib/format";

interface Statement {
  account: { id: string; name: string; type: string };
  period: { year: number; month: number };
  orders: { id: string; orderNo: string; orderDate: string; orderType: string; dinerName: string; total: string }[];
  productWiseSummary: { productId: string; name: string; quantity: string; amount: string }[];
  orderCount: number;
  grandTotal: string;
}

function currentMonthInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function Statements() {
  const { data: accounts } = useBillingAccounts();
  const [accountId, setAccountId] = useState("");
  const [month, setMonth] = useState(currentMonthInput());

  const { data: statement, isFetching } = useQuery({
    queryKey: ["managed-statement", accountId, month],
    enabled: !!accountId,
    queryFn: async () => (await api.get<Statement>(`/managed/accounts/${accountId}/statement`, { params: { month } })).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Monthly Statement</h1>
        <p className="text-sm text-muted">Consolidated month-end bill per company / contractor. Includes served orders and confirmed extras.</p>
      </div>

      <div className="card grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
        <div>
          <label className="label">Account</label>
          <Combobox
            value={accountId}
            onChange={setAccountId}
            options={(accounts ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.type === "COMPANY" ? "Company" : "Contractor"})` }))}
            placeholder="Type to search account…"
          />
        </div>
        <div>
          <label className="label">Month</label>
          <input className="input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>

      {!accountId && <p className="text-muted">Select an account to view its statement.</p>}
      {accountId && isFetching && <p className="text-muted">Loading…</p>}

      {statement && !isFetching && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-bold">{statement.account.name}</p>
              <p className="text-sm text-muted">
                {statement.orderCount} order(s) · {String(statement.period.month).padStart(2, "0")}/{statement.period.year}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Grand Total</p>
              <p className="text-2xl font-bold text-primary">{formatCurrency(statement.grandTotal)}</p>
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold">Product-wise summary</h2>
            <div className="card overflow-x-auto p-0">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="text-right">Total Qty</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.productWiseSummary.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-muted">
                        No billable items this month.
                      </td>
                    </tr>
                  )}
                  {statement.productWiseSummary.map((p) => (
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

          <div>
            <h2 className="mb-2 text-sm font-semibold">Orders</h2>
            <div className="card overflow-x-auto p-0">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Order No</th>
                    <th>Diner</th>
                    <th>Type</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.orders.map((o) => (
                    <tr key={o.id}>
                      <td>{formatDate(o.orderDate)}</td>
                      <td>{o.orderNo}</td>
                      <td>{o.dinerName}</td>
                      <td>{o.orderType}</td>
                      <td className="text-right">{formatCurrency(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
