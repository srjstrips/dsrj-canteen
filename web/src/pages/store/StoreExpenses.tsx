import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { formatCurrency, formatDate, todayInput } from "../../lib/format";
import { Modal } from "../../components/Modal";

interface ExpenseItem {
  expenseName: string;
  qty: string;
  rate: string;
  gstPct: string;
}

interface ExpenseItemRow {
  id: string;
  expenseName: string;
  qty: string;
  rate: string;
  gstPct: string;
  amount: string;
}

interface ExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  invoiceNo: string | null;
  notes: string | null;
  totalAmount: string;
  createdBy: { name: string };
  items: ExpenseItemRow[];
}

interface MonthlySummary {
  month: string;
  entries: number;
  total: string;
}

function emptyItem(): ExpenseItem {
  return { expenseName: "", qty: "1", rate: "", gstPct: "0" };
}

function calcAmount(item: ExpenseItem): number {
  const base = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const gst = base * ((Number(item.gstPct) || 0) / 100);
  return Math.round((base + gst) * 100) / 100;
}

export function StoreExpenses() {
  const queryClient = useQueryClient();

  // Filters
  const [viewMode, setViewMode] = useState<"date" | "month">("month");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [fromDate, setFromDate] = useState(todayInput());
  const [toDate, setToDate] = useState(todayInput());

  // New entry form
  const [showForm, setShowForm] = useState(false);
  const [expenseDate, setExpenseDate] = useState(todayInput());
  const [invoiceNo, setInvoiceNo] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ExpenseItem[]>([emptyItem()]);

  // Detail expand
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ExpenseRow | null>(null);

  const queryParams =
    viewMode === "month"
      ? { month: selectedMonth }
      : { from: fromDate, to: toDate };

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["store-expenses", queryParams],
    queryFn: async () => (await api.get<ExpenseRow[]>("/store/expenses", { params: queryParams })).data,
  });

  const { data: summary } = useQuery({
    queryKey: ["store-expenses-summary"],
    queryFn: async () => (await api.get<MonthlySummary[]>("/store/expenses/summary")).data,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      api.post("/store/expenses", {
        expenseDate,
        invoiceNo: invoiceNo || undefined,
        notes: notes || undefined,
        items: items.map((it) => ({
          expenseName: it.expenseName,
          qty: Number(it.qty),
          rate: Number(it.rate),
          gstPct: Number(it.gstPct) || 0,
        })),
      }),
    onSuccess: () => {
      toast.success("Expense recorded");
      queryClient.invalidateQueries({ queryKey: ["store-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["store-expenses-summary"] });
      setShowForm(false);
      setItems([emptyItem()]);
      setInvoiceNo("");
      setNotes("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/store/expenses/${id}`),
    onSuccess: () => {
      toast.success("Expense deleted");
      queryClient.invalidateQueries({ queryKey: ["store-expenses"] });
      queryClient.invalidateQueries({ queryKey: ["store-expenses-summary"] });
      setConfirmDelete(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function updateItem(i: number, patch: Partial<ExpenseItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (items.some((it) => !it.expenseName.trim())) return toast.error("Expense name is required for every row");
    if (items.some((it) => Number(it.rate) <= 0)) return toast.error("Rate must be greater than 0");
    if (items.some((it) => Number(it.qty) <= 0)) return toast.error("Qty must be greater than 0");
    createMutation.mutate();
  }

  const grandTotal = (expenses ?? []).reduce((s, e) => s + Number(e.totalAmount), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Store Expenses</h1>
          <p className="text-sm text-muted">Record delivery charges, grinding fees, labour and any other expenses.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(true)}>+ New Expense</button>
      </div>

      {/* Monthly summary cards */}
      {summary && summary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {summary.slice(0, 4).map((s) => (
            <button
              key={s.month}
              className={`card text-left transition hover:border-primary ${viewMode === "month" && selectedMonth === s.month ? "border-primary ring-1 ring-primary" : ""}`}
              onClick={() => { setViewMode("month"); setSelectedMonth(s.month); }}
            >
              <p className="text-xs font-semibold text-muted">{s.month}</p>
              <p className="mt-1 text-lg font-bold text-primary">{formatCurrency(s.total)}</p>
              <p className="text-xs text-muted">{s.entries} entr{s.entries === 1 ? "y" : "ies"}</p>
            </button>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div className="card flex flex-wrap items-end gap-3 p-3">
        <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
          <button
            className={`px-3 py-1.5 ${viewMode === "month" ? "bg-primary text-white" : "bg-card text-ink hover:bg-background"}`}
            onClick={() => setViewMode("month")}
          >Monthly</button>
          <button
            className={`px-3 py-1.5 ${viewMode === "date" ? "bg-primary text-white" : "bg-card text-ink hover:bg-background"}`}
            onClick={() => setViewMode("date")}
          >Date Range</button>
        </div>

        {viewMode === "month" ? (
          <div>
            <label className="label">Month</label>
            <input className="input" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
          </div>
        ) : (
          <>
            <div>
              <label className="label">From</label>
              <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div>
              <label className="label">To</label>
              <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </>
        )}

        {!isLoading && expenses && (
          <div className="ml-auto text-right">
            <p className="text-xs text-muted">{expenses.length} entries</p>
            <p className="text-lg font-bold text-primary">{formatCurrency(grandTotal)}</p>
          </div>
        )}
      </div>

      {/* Expense list */}
      {isLoading && <p className="text-muted">Loading…</p>}
      {!isLoading && expenses?.length === 0 && (
        <div className="card py-10 text-center text-muted">No expenses for this period.</div>
      )}

      <div className="space-y-2">
        {expenses?.map((exp) => (
          <div key={exp.id} className="card p-0 overflow-hidden">
            {/* Header row */}
            <div
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 cursor-pointer hover:bg-background"
              onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
            >
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{expandedId === exp.id ? "▲" : "▼"}</span>
                <div>
                  <p className="font-semibold text-sm">{exp.expenseNo}</p>
                  <p className="text-xs text-muted">
                    {formatDate(exp.expenseDate)}
                    {exp.invoiceNo ? ` · Invoice: ${exp.invoiceNo}` : ""}
                    {exp.notes ? ` · ${exp.notes}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-bold text-primary">{formatCurrency(exp.totalAmount)}</p>
                  <p className="text-xs text-muted">{exp.items.length} item{exp.items.length !== 1 ? "s" : ""} · by {exp.createdBy.name}</p>
                </div>
                <button
                  className="btn-secondary !px-2 !py-1 text-xs text-danger hover:border-danger"
                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(exp); }}
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Expanded items */}
            {expandedId === exp.id && (
              <div className="overflow-x-auto border-t border-border">
                <table className="table-base min-w-[500px]">
                  <thead>
                    <tr>
                      <th>Expense Name</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Rate (₹)</th>
                      <th className="text-right">GST %</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exp.items.map((it) => (
                      <tr key={it.id}>
                        <td className="font-medium">{it.expenseName}</td>
                        <td className="text-right">{Number(it.qty)}</td>
                        <td className="text-right">{formatCurrency(it.rate)}</td>
                        <td className="text-right">{Number(it.gstPct) > 0 ? `${it.gstPct}%` : "—"}</td>
                        <td className="text-right font-semibold">{formatCurrency(it.amount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-background font-bold">
                      <td colSpan={4} className="text-right text-xs uppercase tracking-wide text-muted">Total</td>
                      <td className="text-right text-primary">{formatCurrency(exp.totalAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* New Expense Modal */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="New Expense Entry">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Date *</label>
              <input className="input" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} required />
            </div>
            <div>
              <label className="label">Invoice No <span className="text-muted font-normal">(optional)</span></label>
              <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. INV-001" />
            </div>
            <div>
              <label className="label">Notes <span className="text-muted font-normal">(optional)</span></label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Monthly grinding" />
            </div>
          </div>

          {/* Items table */}
          <div className="space-y-2">
            <label className="label">Expense Items *</label>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className="pb-1 text-left font-semibold w-[35%]">Expense Name</th>
                    <th className="pb-1 text-left font-semibold w-[12%]">Qty</th>
                    <th className="pb-1 text-left font-semibold w-[18%]">Rate (₹)</th>
                    <th className="pb-1 text-left font-semibold w-[12%]">GST %</th>
                    <th className="pb-1 text-right font-semibold w-[16%]">Amount</th>
                    <th className="w-[7%]"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1.5 pr-2">
                        <input
                          className="input !py-1.5 text-sm"
                          placeholder="e.g. Delivery charges"
                          value={it.expenseName}
                          onChange={(e) => updateItem(i, { expenseName: e.target.value })}
                          required
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className="input !py-1.5 text-sm"
                          type="number" min={0} step="0.001"
                          value={it.qty}
                          onChange={(e) => updateItem(i, { qty: e.target.value })}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className="input !py-1.5 text-sm"
                          type="number" min={0} step="0.01"
                          placeholder="0.00"
                          value={it.rate}
                          onChange={(e) => updateItem(i, { rate: e.target.value })}
                          required
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className="input !py-1.5 text-sm"
                          type="number" min={0} max={100} step="0.01"
                          placeholder="0"
                          value={it.gstPct}
                          onChange={(e) => updateItem(i, { gstPct: e.target.value })}
                        />
                      </td>
                      <td className="py-1.5 pr-2 text-right font-semibold text-primary">
                        {calcAmount(it) > 0 ? formatCurrency(calcAmount(it)) : "—"}
                      </td>
                      <td className="py-1.5 text-center">
                        <button
                          type="button"
                          className="text-muted hover:text-danger text-sm"
                          onClick={() => setItems(items.length === 1 ? [emptyItem()] : items.filter((_, idx) => idx !== i))}
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              className="btn-secondary !py-1.5 text-xs"
              onClick={() => setItems([...items, emptyItem()])}
            >
              + Add Row
            </button>
          </div>

          {/* Total */}
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm font-semibold text-muted">Grand Total</span>
            <span className="text-xl font-bold text-primary">
              {formatCurrency(items.reduce((s, it) => s + calcAmount(it), 0))}
            </span>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving…" : "Save Expense"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete Expense?">
        <div className="space-y-4">
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <p className="font-semibold">Delete <span className="font-bold">{confirmDelete?.expenseNo}</span>?</p>
            <p className="mt-1 text-xs">This will permanently remove this expense entry. Cannot be undone.</p>
          </div>
          <div className="text-sm space-y-1">
            <p><span className="text-muted">Date:</span> {confirmDelete ? formatDate(confirmDelete.expenseDate) : ""}</p>
            <p><span className="text-muted">Total:</span> {confirmDelete ? formatCurrency(confirmDelete.totalAmount) : ""}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button
              className="btn-danger flex-1"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
