import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useSuppliers } from "../../api/queries";
import { ProductSelect } from "../../components/ProductSelect";
import { BulkImport } from "../../components/BulkImport";
import { formatCurrency, formatDate, todayInput } from "../../lib/format";

interface LineItem {
  productId: string;
  quantity: string;
  rate: string;
}

interface InwardRow {
  id: string;
  inwardNo: string;
  inwardDate: string;
  invoiceNumber?: string;
  totalValue: string;
  supplier: { name: string };
  items: { id: string; quantity: string; rate: string; totalValue: string; product: { name: string; unit: { symbol: string } } }[];
}

function emptyLine(): LineItem {
  return { productId: "", quantity: "", rate: "" };
}

export function StockInward() {
  const queryClient = useQueryClient();
  const { data: suppliers } = useSuppliers();
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [inwardDate, setInwardDate] = useState(todayInput());
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);

  const { data: inwards, isLoading } = useQuery({
    queryKey: ["stock-inwards"],
    queryFn: async () => (await api.get<InwardRow[]>("/store/stock-inward")).data,
  });

  const submitMutation = useMutation({
    mutationFn: async () =>
      api.post("/store/stock-inward", {
        supplierId,
        invoiceNumber: invoiceNumber || undefined,
        inwardDate,
        items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), rate: Number(l.rate) })),
      }),
    onSuccess: () => {
      toast.success("Stock inward recorded");
      queryClient.invalidateQueries({ queryKey: ["stock-inwards"] });
      queryClient.invalidateQueries({ queryKey: ["store-stock"] });
      setSupplierId("");
      setInvoiceNumber("");
      setLines([emptyLine()]);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  async function importInward(file: File) {
    if (!supplierId) {
      toast.error("Select a supplier before bulk importing");
      throw new Error("Supplier is required");
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("supplierId", supplierId);
    if (invoiceNumber) formData.append("invoiceNumber", invoiceNumber);
    formData.append("inwardDate", inwardDate);
    const res = await api.post<{ importedRows: number }>("/store/stock-inward/import", formData);
    queryClient.invalidateQueries({ queryKey: ["stock-inwards"] });
    queryClient.invalidateQueries({ queryKey: ["store-stock"] });
    return res.data;
  }

  function updateLine(index: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  const total = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!supplierId) return toast.error("Supplier is required");
    if (lines.some((l) => !l.productId)) return toast.error("Product is required for every line");
    if (lines.some((l) => Number(l.quantity) <= 0)) return toast.error("Quantity must be greater than 0");
    if (lines.some((l) => Number(l.rate) < 0)) return toast.error("Rate cannot be negative");
    submitMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Stock Inward</h1>
        <p className="text-sm text-muted">Record material received from a supplier. The average rate is recalculated automatically.</p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Supplier</label>
            <select className="input" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select supplier…</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Invoice Number</label>
            <input className="input" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={inwardDate} onChange={(e) => setInwardDate(e.target.value)} />
          </div>
        </div>

        <BulkImport templateUrl="/store/stock-inward/template" templateFilename="stock-inward-template.xlsx" onImport={importInward} disabled={!supplierId} />

        <div className="space-y-2">
          {lines.map((line, i) => {
            const lineTotal = (Number(line.quantity) || 0) * (Number(line.rate) || 0);
            return (
              <div key={i} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <div>
                  <label className="label">Product</label>
                  <ProductSelect value={line.productId} onChange={(productId) => updateLine(i, { productId })} />
                </div>
                <div>
                  <label className="label">Quantity</label>
                  <input className="input" type="number" min={0} step="0.001" required value={line.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} />
                </div>
                <div>
                  <label className="label">Rate (₹)</label>
                  <input className="input" type="number" min={0} step="0.01" required value={line.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} />
                </div>
                <div>
                  <label className="label">Total Value</label>
                  <div className="input bg-background font-medium">{formatCurrency(lineTotal)}</div>
                </div>
                <button
                  type="button"
                  className="btn-secondary !px-2 !py-2 text-xs"
                  onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                  disabled={lines.length === 1}
                >
                  Remove
                </button>
              </div>
            );
          })}
          <button type="button" className="btn-secondary text-xs" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
            + Add Line
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="font-semibold">
            Total Value: <span className="text-primary">{formatCurrency(total)}</span>
          </p>
          <button className="btn-primary" type="submit" disabled={submitMutation.isPending}>
            {submitMutation.isPending ? "Saving…" : "Record Inward"}
          </button>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <h2 className="p-4 pb-0 font-semibold">Recent Inward Entries</h2>
        <table className="table-base mt-2">
          <thead>
            <tr>
              <th>Inward No.</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Invoice</th>
              <th>Items</th>
              <th>Total Value</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            )}
            {inwards?.map((inward) => (
              <tr key={inward.id}>
                <td className="font-medium">{inward.inwardNo}</td>
                <td>{formatDate(inward.inwardDate)}</td>
                <td>{inward.supplier.name}</td>
                <td>{inward.invoiceNumber ?? "—"}</td>
                <td>{inward.items.map((it) => `${it.product.name} (${it.quantity} ${it.product.unit.symbol} @ ₹${it.rate})`).join(", ")}</td>
                <td>{formatCurrency(inward.totalValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
