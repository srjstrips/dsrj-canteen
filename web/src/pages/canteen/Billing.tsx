import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import { api } from "../../api/client";
import { useCategories, useProducts } from "../../api/queries";
import { queueSaleOffline } from "../../offline/offlineQueue";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { PaymentMode, Sale } from "../../types";

interface CartLine {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  rate: number;
  discount: number;
}

interface ReceiptData {
  billNo: string;
  billTime: string;
  items: CartLine[];
  subTotal: number;
  discountTotal: number;
  grandTotal: number;
  paymentMode: PaymentMode;
  pending: boolean;
}

export function Billing() {
  const queryClient = useQueryClient();
  const { data: products } = useProducts(true);
  const { data: categories } = useCategories();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [customerRef, setCustomerRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const { data: todaysBills } = useQuery({
    queryKey: ["sales", "today"],
    queryFn: async () => (await api.get<Sale[]>("/canteen/sales")).data,
  });

  const filteredProducts = useMemo(() => {
    return (products ?? []).filter((p) => {
      if (categoryId && p.categoryId !== categoryId) return false;
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [products, categoryId, search]);

  function addToCart(productId: string) {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) => (l.productId === productId ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { productId, name: product.name, unit: product.unit.symbol, quantity: 1, rate: Number(product.sellPrice ?? 0), discount: 0 }];
    });
  }

  function updateLine(productId: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  const subTotal = cart.reduce((sum, l) => sum + l.quantity * l.rate, 0);
  const discountTotal = cart.reduce((sum, l) => sum + l.discount, 0);
  const grandTotal = subTotal - discountTotal;

  async function generateBill() {
    if (cart.length === 0) return toast.error("Add at least one item to the bill");
    if (cart.some((l) => l.quantity <= 0)) return toast.error("Quantity must be greater than 0");
    if (cart.some((l) => l.rate < 0)) return toast.error("Rate cannot be negative");

    setSubmitting(true);
    const items = cart.map((l) => ({ productId: l.productId, quantity: l.quantity, rate: l.rate, discount: l.discount }));

    try {
      if (!navigator.onLine) throw { isOfflineShortCircuit: true };
      const res = await api.post<Sale>("/canteen/sales", { items, paymentMode, customerRef: customerRef || undefined });
      setReceipt({
        billNo: res.data.billNo,
        billTime: res.data.billTime,
        items: cart,
        subTotal,
        discountTotal,
        grandTotal,
        paymentMode,
        pending: false,
      });
      toast.success(`Bill ${res.data.billNo} created`);
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["canteen-stock"] });
      setCart([]);
      setCustomerRef("");
    } catch (error) {
      const isNetworkError = (axios.isAxiosError(error) && !error.response) || (error as { isOfflineShortCircuit?: boolean })?.isOfflineShortCircuit;
      if (isNetworkError) {
        const queued = await queueSaleOffline({ items, paymentMode, customerRef: customerRef || undefined });
        setReceipt({
          billNo: `OFFLINE-${queued.clientRef.slice(-8)}`,
          billTime: queued.createdAt,
          items: cart,
          subTotal,
          discountTotal,
          grandTotal,
          paymentMode,
          pending: true,
        });
        toast.success("You're offline — bill saved and will sync automatically");
        setCart([]);
        setCustomerRef("");
      } else {
        const message = axios.isAxiosError(error) ? (error.response?.data as { error?: string })?.error : undefined;
        toast.error(message ?? "Failed to create bill");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold">Billing / POS</h1>
          <p className="text-sm text-muted">Tap a product to add it to the bill</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input className="input max-w-xs" placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <button className={categoryId === "" ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"} onClick={() => setCategoryId("")}>
            All
          </button>
          {categories?.map((c) => (
            <button
              key={c.id}
              className={categoryId === c.id ? "btn-primary !px-3 !py-1.5 text-xs" : "btn-secondary !px-3 !py-1.5 text-xs"}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {filteredProducts.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p.id)}
              className="card flex flex-col items-start gap-1 text-left transition hover:border-primary hover:shadow-md"
            >
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs text-muted">{p.category.name}</span>
              <span className="mt-auto text-sm font-bold text-primary">{p.sellPrice ? formatCurrency(p.sellPrice) : "Set price"}</span>
            </button>
          ))}
          {filteredProducts.length === 0 && <p className="text-muted">No products match.</p>}
        </div>

        <div className="card overflow-x-auto p-0">
          <h2 className="p-4 pb-0 font-semibold">Today's Bills</h2>
          <table className="table-base mt-2">
            <thead>
              <tr>
                <th>Bill No.</th>
                <th>Time</th>
                <th>Payment</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {todaysBills?.slice(0, 8).map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.billNo}</td>
                  <td>{formatDateTime(s.billTime)}</td>
                  <td>{s.paymentMode}</td>
                  <td className="text-right">{formatCurrency(s.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card sticky top-20 h-fit space-y-3">
        <h2 className="font-semibold">Current Bill</h2>
        {cart.length === 0 && <p className="text-sm text-muted">No items yet.</p>}
        <div className="space-y-2">
          {cart.map((line) => (
            <div key={line.productId} className="rounded-lg border border-border p-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{line.name}</span>
                <button className="text-xs text-danger" onClick={() => removeLine(line.productId)}>
                  Remove
                </button>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1.5">
                <input
                  className="input !py-1 text-xs"
                  type="number"
                  min={0}
                  step="0.001"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.productId, { quantity: Number(e.target.value) })}
                  aria-label="Quantity"
                />
                <input
                  className="input !py-1 text-xs"
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.rate}
                  onChange={(e) => updateLine(line.productId, { rate: Number(e.target.value) })}
                  aria-label="Rate"
                />
                <input
                  className="input !py-1 text-xs"
                  type="number"
                  min={0}
                  step="0.01"
                  value={line.discount}
                  onChange={(e) => updateLine(line.productId, { discount: Number(e.target.value) })}
                  aria-label="Discount"
                  title="Discount"
                />
              </div>
              <p className="mt-1 text-right text-sm font-semibold">{formatCurrency(line.quantity * line.rate - line.discount)}</p>
            </div>
          ))}
        </div>

        <div className="space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(subTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{formatCurrency(discountTotal)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(grandTotal)}</span>
          </div>
        </div>

        <div>
          <label className="label">Payment Method</label>
          <div className="flex gap-2">
            {(["CASH", "UPI", "CREDIT"] as PaymentMode[]).map((mode) => (
              <button
                key={mode}
                className={paymentMode === mode ? "btn-primary flex-1 !py-1.5 text-xs" : "btn-secondary flex-1 !py-1.5 text-xs"}
                onClick={() => setPaymentMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {paymentMode === "CREDIT" && (
          <div>
            <label className="label">Employee / Customer Account</label>
            <input className="input" value={customerRef} onChange={(e) => setCustomerRef(e.target.value)} placeholder="Employee ID or name" />
          </div>
        )}

        <button className="btn-primary w-full" onClick={generateBill} disabled={submitting || cart.length === 0}>
          {submitting ? "Generating…" : "Generate Bill"}
        </button>
      </div>

      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Receipt({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="card w-full max-w-sm print:shadow-none">
        <div className="text-center">
          <h2 className="font-bold">Divya SRJ Canteen</h2>
          <p className="text-xs text-muted">Bill No: {receipt.billNo}</p>
          <p className="text-xs text-muted">{formatDateTime(receipt.billTime)}</p>
          {receipt.pending && <p className="badge-danger mt-1 inline-block">Pending Sync (Offline)</p>}
        </div>
        <table className="table-base mt-3">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((l) => (
              <tr key={l.productId}>
                <td>{l.name}</td>
                <td className="text-right">{l.quantity}</td>
                <td className="text-right">{l.rate}</td>
                <td className="text-right">{(l.quantity * l.rate - l.discount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 space-y-1 border-t border-border pt-2 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(receipt.subTotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount</span>
            <span>-{formatCurrency(receipt.discountTotal)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span>{formatCurrency(receipt.grandTotal)}</span>
          </div>
          <p>Payment: {receipt.paymentMode}</p>
        </div>
        <div className="mt-4 flex gap-2 print:hidden">
          <button className="btn-secondary flex-1" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn-primary flex-1" onClick={onClose}>
            New Sale
          </button>
        </div>
      </div>
    </div>
  );
}
