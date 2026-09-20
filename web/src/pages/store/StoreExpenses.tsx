import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { formatCurrency, formatDate, todayInput } from "../../lib/format";
import { Modal } from "../../components/Modal";
import { useAuth } from "../../auth/AuthContext";

interface ExpenseItem {
  expenseName: string;
  qty: string;
  rate: string;
  gstMode: "pct" | "amount";
  gstPct: string;
  gstAmount: string;
}

interface ExpenseItemRow {
  id: string;
  expenseName: string;
  qty: string;
  rate: string;
  gstPct: string;
  gstAmount: string;
  amount: string;
}

interface ExpenseRow {
  id: string;
  expenseNo: string;
  expenseDate: string;
  invoiceNo: string | null;
  notes: string | null;
  totalAmount: string;
  createdAt: string;
  createdBy: { name: string };
  items: ExpenseItemRow[];
}

const LOCK_MS = 48 * 60 * 60 * 1000;
function isLocked(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() > LOCK_MS;
}

interface MonthlySummary {
  month: string;
  entries: number;
  total: string;
}

function emptyItem(): ExpenseItem {
  return { expenseName: "", qty: "1", rate: "", gstMode: "pct", gstPct: "0", gstAmount: "0" };
}

function calcAmount(item: ExpenseItem): number {
  const base = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const gst = item.gstMode === "amount"
    ? (Number(item.gstAmount) || 0)
    : base * ((Number(item.gstPct) || 0) / 100);
  return Math.round((base + gst) * 100) / 100;
}

function rowToFormItems(rows: ExpenseItemRow[]): ExpenseItem[] {
  return rows.map((r) => ({
    expenseName: r.expenseName,
    qty: String(Number(r.qty)),
    rate: String(Number(r.rate)),
    gstMode: Number(r.gstAmount) > 0 && Number(r.gstPct) === 0 ? "amount" as const : "pct" as const,
    gstPct: String(Number(r.gstPct)),
    gstAmount: String(Number(r.gstAmount)),
  }));
}

// Shared form used for both create and edit
function ExpenseForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ExpenseRow;
  onSave: (data: { expenseDate: string; invoiceNo: string; notes: string; items: ExpenseItem[] }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [expenseDate, setExpenseDate] = useState(initial?.expenseDate?.slice(0, 10) ?? todayInput());
  const [invoiceNo, setInvoiceNo] = useState(initial?.invoiceNo ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [items, setItems] = useState<ExpenseItem[]>(initial ? rowToFormItems(initial.items) : [emptyItem()]);

  function updateItem(i: number, patch: Partial<ExpenseItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (items.some((it) => !it.expenseName.trim())) return toast.error("Expense name is required for every row");
    if (items.some((it) => Number(it.rate) <= 0)) return toast.error("Rate must be > 0 for every row");
    if (items.some((it) => Number(it.qty) <= 0)) return toast.error("Qty must be > 0 for every row");
    onSave({ expenseDate, invoiceNo, notes, items });
  }

  const grandTotal = items.reduce((s, it) => s + calcAmount(it), 0);

  return (
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

      <div className="space-y-2">
        <label className="label">Expense Items *</label>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th className="pb-1 text-left font-semibold w-[30%]">Expense Name</th>
                <th className="pb-1 text-left font-semibold w-[10%]">Qty</th>
                <th className="pb-1 text-left font-semibold w-[15%]">Rate (₹)</th>
                <th className="pb-1 text-left font-semibold w-[22%]">GST</th>
                <th className="pb-1 text-right font-semibold w-[16%]">Amount</th>
                <th className="w-[7%]"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 pr-2">
                    <input className="input !py-1.5 text-sm" placeholder="e.g. Delivery charges"
                      value={it.expenseName} onChange={(e) => updateItem(i, { expenseName: e.target.value })} required />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input className="input !py-1.5 text-sm" type="number" min={0} step="0.001"
                      value={it.qty} onChange={(e) => updateItem(i, { qty: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input className="input !py-1.5 text-sm" type="number" min={0} step="0.01" placeholder="0.00"
                      value={it.rate} onChange={(e) => updateItem(i, { rate: e.target.value })} required />
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex gap-1 items-center">
                      <div className="flex rounded border border-border overflow-hidden text-xs">
                        <button type="button"
                          className={`px-1.5 py-1 ${it.gstMode === "pct" ? "bg-primary text-white" : "bg-card text-ink hover:bg-background"}`}
                          onClick={() => updateItem(i, { gstMode: "pct" })}
                        >%</button>
                        <button type="button"
                          className={`px-1.5 py-1 ${it.gstMode === "amount" ? "bg-primary text-white" : "bg-card text-ink hover:bg-background"}`}
                          onClick={() => updateItem(i, { gstMode: "amount" })}
                        >₹</button>
                      </div>
                      {it.gstMode === "pct" ? (
                        <input className="input !py-1.5 text-sm min-w-0" type="number" min={0} max={100} step="0.01" placeholder="0"
                          value={it.gstPct} onChange={(e) => updateItem(i, { gstPct: e.target.value })} />
                      ) : (
                        <input className="input !py-1.5 text-sm min-w-0" type="number" min={0} step="0.01" placeholder="0.00"
                          value={it.gstAmount} onChange={(e) => updateItem(i, { gstAmount: e.target.value })} />
                      )}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-right font-semibold text-primary">
                    {calcAmount(it) > 0 ? formatCurrency(calcAmount(it)) : "—"}
                  </td>
                  <td className="py-1.5 text-center">
                    <button type="button" className="text-muted hover:text-danger text-sm"
                      onClick={() => setItems(items.length === 1 ? [emptyItem()] : items.filter((_, idx) => idx !== i))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => setItems([...items, emptyItem()])}>
          + Add Row
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <span className="text-sm font-semibold text-muted">Grand Total</span>
        <span className="text-xl font-bold text-primary">{formatCurrency(grandTotal)}</span>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
          {saving ? "Saving…" : "Save Expense"}
        </button>
      </div>
    </form>
  );
}

export function StoreExpenses() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [viewMode, setViewMode] = useState<"date" | "month">("month");
  const [selectedMonth, setSelectedMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [fromDate, setFromDate] = useState(todayInput());
  const [toDate, setToDate] = useState(todayInput());

  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | "all" | null>(null);

  const queryParams = viewMode === "month" ? { month: selectedMonth } : { from: fromDate, to: toDate };

  const { data: expenses, isLoading } = useQuery({
    queryKey: ["store-expenses", queryParams],
    queryFn: async () => (await api.get<ExpenseRow[]>("/store/expenses", { params: queryParams })).data,
  });

  const { data: summary } = useQuery({
    queryKey: ["store-expenses-summary"],
    queryFn: async () => (await api.get<MonthlySummary[]>("/store/expenses/summary")).data,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["store-expenses"] });
    queryClient.invalidateQueries({ queryKey: ["store-expenses-summary"] });
  }

  const createMutation = useMutation({
    mutationFn: async (data: Parameters<typeof api.post>[1]) => api.post("/store/expenses", data),
    onSuccess: () => { toast.success("Expense recorded"); invalidate(); setShowCreate(false); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: unknown }) => api.patch(`/store/expenses/${id}`, data),
    onSuccess: () => { toast.success("Expense updated"); invalidate(); setEditing(null); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids: string[] | "all") =>
      ids === "all"
        ? api.delete("/store/expenses", { data: { ids: "all" } })
        : ids.length === 1
        ? api.delete(`/store/expenses/${ids[0]}`)
        : api.delete("/store/expenses", { data: { ids } }),
    onSuccess: (_, ids) => {
      const label = ids === "all" ? "All expenses" : ids.length === 1 ? "Expense" : `${ids.length} expenses`;
      toast.success(`${label} deleted`);
      invalidate();
      setSelected(new Set());
      setConfirmDeleteIds(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function buildPayload(d: { expenseDate: string; invoiceNo: string; notes: string; items: ExpenseItem[] }) {
    return {
      expenseDate: d.expenseDate,
      invoiceNo: d.invoiceNo || undefined,
      notes: d.notes || undefined,
      items: d.items.map((it) => ({ expenseName: it.expenseName, qty: Number(it.qty), rate: Number(it.rate), gstMode: it.gstMode, gstPct: Number(it.gstPct) || 0, gstAmount: Number(it.gstAmount) || 0 })),
    };
  }

  const allIds = (expenses ?? []).map((e) => e.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(allIds));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const grandTotal = (expenses ?? []).reduce((s, e) => s + Number(e.totalAmount), 0);

  const confirmLabel =
    confirmDeleteIds === "all"
      ? "ALL expense entries"
      : confirmDeleteIds?.length === 1
      ? "this expense entry"
      : `${confirmDeleteIds?.length} expense entries`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Store Expenses</h1>
          <p className="text-sm text-muted">Record delivery charges, grinding fees, labour and any other expenses.</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>+ New Expense</button>
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
          <button className={`px-3 py-1.5 ${viewMode === "month" ? "bg-primary text-white" : "bg-card text-ink hover:bg-background"}`} onClick={() => setViewMode("month")}>Monthly</button>
          <button className={`px-3 py-1.5 ${viewMode === "date" ? "bg-primary text-white" : "bg-card text-ink hover:bg-background"}`} onClick={() => setViewMode("date")}>Date Range</button>
        </div>
        {viewMode === "month" ? (
          <div><label className="label">Month</label>
            <input className="input" type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /></div>
        ) : (
          <>
            <div><label className="label">From</label><input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></div>
            <div><label className="label">To</label><input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></div>
          </>
        )}
        {!isLoading && expenses && (
          <div className="ml-auto text-right">
            <p className="text-xs text-muted">{expenses.length} entries</p>
            <p className="text-lg font-bold text-primary">{formatCurrency(grandTotal)}</p>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {(expenses ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 accent-primary" />
            {allSelected ? "Deselect all" : "Select all"}
          </label>
          {selected.size > 0 && (
            <button
              className="btn-danger !px-3 !py-1.5 text-xs"
              onClick={() => setConfirmDeleteIds([...selected])}
            >
              Delete selected ({selected.size})
            </button>
          )}
          {isAdmin && (
            <button
              className="btn-secondary !px-3 !py-1.5 text-xs text-danger hover:border-danger ml-auto"
              onClick={() => setConfirmDeleteIds("all")}
            >
              Delete All
            </button>
          )}
          {!isAdmin && (
            <span className="ml-auto text-xs text-muted">🔒 Entries older than 48h are locked — contact Admin to delete</span>
          )}
        </div>
      )}

      {isLoading && <p className="text-muted">Loading…</p>}
      {!isLoading && expenses?.length === 0 && (
        <div className="card py-10 text-center text-muted">No expenses for this period.</div>
      )}

      <div className="space-y-2">
        {expenses?.map((exp) => (
          <div key={exp.id} className={`card p-0 overflow-hidden transition ${selected.has(exp.id) ? "ring-1 ring-primary border-primary" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={selected.has(exp.id)}
                onChange={() => toggle(exp.id)}
                className="h-4 w-4 accent-primary flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              />

              {/* Expand toggle */}
              <button
                className="flex flex-1 items-center gap-3 text-left"
                onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
              >
                <span className="text-xs text-muted">{expandedId === exp.id ? "▲" : "▼"}</span>
                <div>
                  <p className="font-semibold text-sm">{exp.expenseNo}</p>
                  <p className="text-xs text-muted">
                    {formatDate(exp.expenseDate)}
                    {exp.invoiceNo ? ` · Invoice: ${exp.invoiceNo}` : ""}
                    {exp.notes ? ` · ${exp.notes}` : ""}
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="text-right">
                  <p className="font-bold text-primary">{formatCurrency(exp.totalAmount)}</p>
                  <p className="text-xs text-muted">{exp.items.length} item{exp.items.length !== 1 ? "s" : ""} · {exp.createdBy.name}</p>
                </div>
                {!isAdmin && isLocked(exp.createdAt) ? (
                  <span className="text-xs text-muted px-2">🔒 Locked</span>
                ) : (
                  <>
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setEditing(exp)}>Edit</button>
                    <button className="btn-secondary !px-2 !py-1 text-xs text-danger hover:border-danger" onClick={() => setConfirmDeleteIds([exp.id])}>Delete</button>
                  </>
                )}
              </div>
            </div>

            {expandedId === exp.id && (
              <div className="overflow-x-auto border-t border-border">
                <table className="table-base min-w-[500px]">
                  <thead>
                    <tr>
                      <th>Expense Name</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Rate (₹)</th>
                      <th className="text-right">GST</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exp.items.map((it) => (
                      <tr key={it.id}>
                        <td className="font-medium">{it.expenseName}</td>
                        <td className="text-right">{Number(it.qty)}</td>
                        <td className="text-right">{formatCurrency(it.rate)}</td>
                        <td className="text-right">
                          {Number(it.gstAmount) > 0
                            ? <>{formatCurrency(it.gstAmount)}<span className="text-muted text-xs ml-1">({Number(it.gstPct).toFixed(1)}%)</span></>
                            : Number(it.gstPct) > 0 ? `${it.gstPct}%` : "—"}
                        </td>
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

      {/* Create Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Expense Entry">
        <ExpenseForm
          onSave={(d) => createMutation.mutate(buildPayload(d))}
          onCancel={() => setShowCreate(false)}
          saving={createMutation.isPending}
        />
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit — ${editing?.expenseNo ?? ""}`}>
        {editing && (
          <ExpenseForm
            initial={editing}
            onSave={(d) => editMutation.mutate({ id: editing.id, data: buildPayload(d) })}
            onCancel={() => setEditing(null)}
            saving={editMutation.isPending}
          />
        )}
      </Modal>

      {/* Delete confirm */}
      <Modal open={confirmDeleteIds !== null} onClose={() => setConfirmDeleteIds(null)} title="Confirm Delete">
        <div className="space-y-4">
          <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            <p className="font-semibold">Delete {confirmLabel}?</p>
            <p className="mt-1 text-xs">This is permanent and cannot be undone.</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setConfirmDeleteIds(null)}>Cancel</button>
            <button
              className="btn-danger flex-1"
              disabled={deleteMutation.isPending}
              onClick={() => confirmDeleteIds !== null && deleteMutation.mutate(confirmDeleteIds)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Yes, Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
