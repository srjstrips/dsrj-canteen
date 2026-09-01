import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import axios from "axios";
import { api, imageSrc } from "../../api/client";
import { useCategories, useSellableProducts } from "../../api/queries";
import { queueSaleOffline } from "../../offline/offlineQueue";
import { formatCurrency, formatDateTime } from "../../lib/format";
import { CanteenStockRow, PaymentMode, Sale } from "../../types";

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
  const { data: products } = useSellableProducts();
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

  // Stock quantities (only meaningful for stock-tracked packaged goods).
  const { data: canteenStock } = useQuery({
    queryKey: ["canteen-stock", "pos"],
    queryFn: async () => (await api.get<CanteenStockRow[]>("/canteen/stock")).data,
  });
  const stockFor = (productId: string) => canteenStock?.find((s) => s.productId === productId)?.balanceQty;

  // Product count per category for the tab badges.
  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    (products ?? []).forEach((p) => m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1));
    return m;
  }, [products]);

  const rawActiveCategories = (categories ?? []).filter((c) => (countByCategory.get(c.id) ?? 0) > 0);

  // Persist category tab order in localStorage so the user's drag order survives refresh.
  const [catOrder, setCatOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("billing-cat-order") ?? "[]"); } catch { return []; }
  });
  const activeCategories = useMemo(() => {
    const known = new Map(rawActiveCategories.map((c) => [c.id, c]));
    const ordered = catOrder.filter((id) => known.has(id)).map((id) => known.get(id)!);
    const rest = rawActiveCategories.filter((c) => !catOrder.includes(c.id));
    return [...ordered, ...rest];
  }, [rawActiveCategories, catOrder]);

  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function onDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("catId", id);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const srcId = e.dataTransfer.getData("catId");
    if (!srcId || srcId === targetId) return;
    const ids = activeCategories.map((c) => c.id);
    const from = ids.indexOf(srcId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, srcId);
    setCatOrder(ids);
    localStorage.setItem("billing-cat-order", JSON.stringify(ids));
    setDragOverId(null);
  }

  const qtyInCart = (productId: string) => cart.find((l) => l.productId === productId)?.quantity ?? 0;
  function changeQty(productId: string, delta: number) {
    const current = qtyInCart(productId);
    const next = Number((current + delta).toFixed(3));
    if (next <= 0) return removeLine(productId);
    if (current === 0) return addToCart(productId);
    updateLine(productId, { quantity: next });
  }

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

  const totalItems = cart.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_400px] xl:h-[calc(100vh-7.5rem)]">
      <div className="space-y-4 xl:overflow-y-auto xl:pr-1">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🛒</span>
          <div>
            <h1 className="text-xl font-bold">Billing / POS</h1>
            <p className="text-sm text-muted">Tap a product to add it to the bill</p>
          </div>
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">🔍</span>
          <input className="input pl-9" placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${categoryId === "" ? "bg-primary text-white" : "border border-border bg-card hover:bg-background"}`}
            onClick={() => setCategoryId("")}
          >
            All ({products?.length ?? 0})
          </button>
          {activeCategories.map((c) => (
            <button
              key={c.id}
              draggable
              onDragStart={(e) => onDragStart(e, c.id)}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(c.id); }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={(e) => onDrop(e, c.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all cursor-grab active:cursor-grabbing
                ${categoryId === c.id ? "bg-primary text-white" : "border border-border bg-card hover:bg-background"}
                ${dragOverId === c.id ? "ring-2 ring-primary ring-offset-1 scale-105" : ""}`}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name} ({countByCategory.get(c.id)})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filteredProducts.map((p) => {
            const qty = qtyInCart(p.id);
            const selected = qty > 0;
            const stock = p.trackCanteenStock ? stockFor(p.id) : undefined;
            return (
              <div
                key={p.id}
                className={`overflow-hidden rounded-lg border bg-card transition ${selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary hover:shadow"}`}
              >
                <button className="block w-full text-left" onClick={() => addToCart(p.id)}>
                  {p.imageUrl ? (
                    <img src={imageSrc(p.imageUrl)} alt="" className="h-20 w-full bg-background object-contain" />
                  ) : (
                    <div className="flex h-20 w-full items-center justify-center bg-background text-2xl text-muted">🍽</div>
                  )}
                  <div className="p-2">
                    <p className="truncate text-sm font-semibold leading-tight" title={p.name}>
                      {p.name}
                    </p>
                    <p className="text-[11px] font-bold text-primary">{p.sellPrice ? formatCurrency(p.sellPrice) : "Set price"}</p>
                    {stock !== undefined && <p className="text-[11px] font-medium text-success">Stock: {Number(stock)}</p>}
                  </div>
                </button>
                <div className="flex items-center gap-1 border-t border-border p-1">
                  <button
                    className={`flex h-7 flex-1 items-center justify-center rounded text-base font-bold ${selected ? "bg-primary-light text-primary" : "bg-background text-ink"}`}
                    onClick={() => changeQty(p.id, -1)}
                    aria-label="Decrease"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-sm font-semibold">{qty}</span>
                  <button
                    className={`flex h-7 flex-1 items-center justify-center rounded text-base font-bold ${selected ? "bg-primary text-white" : "bg-background text-ink"}`}
                    onClick={() => changeQty(p.id, 1)}
                    aria-label="Increase"
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
          {filteredProducts.length === 0 && <p className="text-muted">No products match.</p>}
        </div>

      </div>

      <div className="card space-y-3 xl:overflow-y-auto xl:h-full">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Current Bill</h2>
          {cart.length > 0 && (
            <button className="flex items-center gap-1 text-sm font-medium text-danger" onClick={() => setCart([])}>
              🗑 Clear All
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No items yet. Tap a product to add it.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="pb-1 text-left font-semibold">Item</th>
                  <th className="pb-1 text-right font-semibold">Rate</th>
                  <th className="pb-1 text-center font-semibold">Qty</th>
                  <th className="pb-1 text-right font-semibold">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((line) => {
                  const product = products?.find((p) => p.id === line.productId);
                  return (
                    <tr key={line.productId} className="border-t border-border">
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          {product?.imageUrl ? (
                            <img src={imageSrc(product.imageUrl)} alt="" className="h-8 w-8 rounded-md object-cover" />
                          ) : (
                            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-background">🍽</span>
                          )}
                          <span className="font-medium leading-tight">{line.name}</span>
                        </div>
                      </td>
                      <td className="text-right">{Number(line.rate).toFixed(2)}</td>
                      <td>
                        <div className="flex items-center justify-center gap-1">
                          <button className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-primary" onClick={() => changeQty(line.productId, -1)}>
                            −
                          </button>
                          <span className="w-6 text-center font-semibold">{line.quantity}</span>
                          <button className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-primary" onClick={() => changeQty(line.productId, 1)}>
                            +
                          </button>
                        </div>
                      </td>
                      <td className="text-right font-semibold">{(line.quantity * line.rate - line.discount).toFixed(2)}</td>
                      <td className="pl-1 text-right">
                        <button className="text-muted hover:text-danger" onClick={() => removeLine(line.productId)} aria-label="Remove">
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="space-y-1 border-t border-border pt-3 text-sm">
          <div className="flex justify-between text-muted">
            <span>Items</span>
            <span className="font-medium text-ink">{Number(totalItems.toFixed(3))}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span>Products</span>
            <span className="font-medium text-ink">{cart.length}</span>
          </div>
          <div className="flex justify-between pt-1">
            <span>Subtotal</span>
            <span>{formatCurrency(subTotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Discount</span>
            <div className="flex items-center gap-2">
              <input
                className="input h-8 w-24 text-right"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={cart.length ? cart[0].discount : 0}
                onChange={(e) => cart.length && updateLine(cart[0].productId, { discount: Number(e.target.value) })}
                disabled={cart.length === 0}
                aria-label="Discount"
              />
              <span className="text-muted">-{formatCurrency(discountTotal)}</span>
            </div>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-lg font-bold">
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
                className={`flex-1 rounded-lg py-2 text-sm font-semibold ${paymentMode === mode ? "bg-primary text-white" : "border border-border bg-card hover:bg-background"}`}
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

        <button className="btn-primary w-full !py-3 text-base" onClick={generateBill} disabled={submitting || cart.length === 0}>
          {submitting ? "Generating…" : "🧾 Generate Bill"}
        </button>

        {/* Today's Bills */}
        <TodaysBills bills={todaysBills ?? []} />
      </div>

      {receipt && <Receipt receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function Receipt({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  // Auto-open the print dialog when the bill is generated.
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  return createPortal(
    <div className="receipt-modal fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="receipt-card card w-full max-w-xs">
        {/* Printable area — thermal 80mm receipt */}
        <div className="receipt-print text-sm">
          <div className="text-center">
            <h2 className="text-base font-bold">Indrayani Upahar Gruh</h2>
            <p className="text-[11px]">Canteen</p>
            <div className="my-1 border-t border-dashed border-ink/40" />
            <p className="text-[11px]">Bill No: {receipt.billNo}</p>
            <p className="text-[11px]">{formatDateTime(receipt.billTime)}</p>
            {receipt.pending && <p className="mt-1 text-[11px] font-semibold">** OFFLINE — will sync **</p>}
          </div>

          <div className="my-1 border-t border-dashed border-ink/40" />
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-dashed border-ink/40">
                <th className="py-0.5 text-left font-semibold">Item</th>
                <th className="text-right font-semibold">Qty</th>
                <th className="text-right font-semibold">Rate</th>
                <th className="text-right font-semibold">Amt</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((l) => (
                <tr key={l.productId}>
                  <td className="py-0.5">{l.name}</td>
                  <td className="text-right">{Number(l.quantity)}</td>
                  <td className="text-right">{Number(l.rate).toFixed(2)}</td>
                  <td className="text-right">{(l.quantity * l.rate - l.discount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="my-1 border-t border-dashed border-ink/40" />
          <div className="space-y-0.5 text-[12px]">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatCurrency(receipt.subTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Discount</span>
              <span>-{formatCurrency(receipt.discountTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-ink/40 pt-0.5 text-sm font-bold">
              <span>TOTAL</span>
              <span>{formatCurrency(receipt.grandTotal)}</span>
            </div>
            <p className="pt-0.5">Payment: {receipt.paymentMode}</p>
          </div>

          <div className="my-1 border-t border-dashed border-ink/40" />
          <p className="text-center text-[11px]">Thank you! Visit again 🙏</p>
        </div>

        {/* Actions — hidden when printing */}
        <div className="no-print mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => window.print()}>
            🖨 Print
          </button>
          <button className="btn-primary flex-1" onClick={onClose}>
            New Sale
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Today's Bills sidebar section
// ---------------------------------------------------------------------------
function TodaysBills({ bills }: { bills: Sale[] }) {
  const [open, setOpen] = useState(true);
  const [reprint, setReprint] = useState<Sale | null>(null);
  const [printAll, setPrintAll] = useState(false);

  const todayTotal = bills.reduce((s, b) => s + Number(b.grandTotal), 0);

  return (
    <>
      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between">
          <button
            className="flex items-center gap-1 text-sm font-semibold"
            onClick={() => setOpen((o) => !o)}
          >
            🕐 Today's Bills ({bills.length})
            <span className="text-xs text-muted">{open ? "▲" : "▼"}</span>
          </button>
          {bills.length > 0 && (
            <button
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setPrintAll(true)}
            >
              🖨 Print All
            </button>
          )}
        </div>

        {open && (
          <div className="mt-2 space-y-1">
            {bills.length === 0 && (
              <p className="py-3 text-center text-xs text-muted">No bills yet today.</p>
            )}
            {bills.map((b) => (
              <button
                key={b.id}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs hover:bg-background"
                onClick={() => setReprint(b)}
              >
                <span className="font-semibold text-primary">{b.billNo}</span>
                <span className="text-muted">{formatDateTime(b.billTime)}</span>
                <span className="font-medium">{formatCurrency(b.grandTotal)}</span>
                <span className="text-[10px] text-muted">{b.paymentMode}</span>
              </button>
            ))}
            {bills.length > 0 && (
              <div className="flex justify-between border-t border-border pt-1 text-xs font-bold">
                <span>Day Total</span>
                <span className="text-primary">{formatCurrency(todayTotal)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {reprint && <ReprintModal sale={reprint} onClose={() => setReprint(null)} />}
      {printAll && <PrintAllModal bills={bills} onClose={() => setPrintAll(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reprint a single past bill
// ---------------------------------------------------------------------------
function ReprintModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  return createPortal(
    <div className="receipt-modal fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="receipt-card card w-full max-w-xs">
        <div className="receipt-print text-sm">
          <div className="text-center">
            <h2 className="text-base font-bold">Indrayani Upahar Gruh</h2>
            <p className="text-[11px]">Canteen</p>
            <div className="my-1 border-t border-dashed border-ink/40" />
            <p className="text-[11px]">Bill No: {sale.billNo}</p>
            <p className="text-[11px]">{formatDateTime(sale.billTime)}</p>
            <p className="text-[10px] font-semibold text-muted">** REPRINT **</p>
          </div>
          <div className="my-1 border-t border-dashed border-ink/40" />
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-dashed border-ink/40">
                <th className="py-0.5 text-left font-semibold">Item</th>
                <th className="text-right font-semibold">Qty</th>
                <th className="text-right font-semibold">Rate</th>
                <th className="text-right font-semibold">Amt</th>
              </tr>
            </thead>
            <tbody>
              {sale.items.map((l) => (
                <tr key={l.id}>
                  <td className="py-0.5">{l.product?.name ?? "-"}</td>
                  <td className="text-right">{Number(l.quantity)}</td>
                  <td className="text-right">{Number(l.rate).toFixed(2)}</td>
                  <td className="text-right">{Number(l.amount).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="my-1 border-t border-dashed border-ink/40" />
          <div className="space-y-0.5 text-[12px]">
            <div className="flex justify-between">
              <span>Subtotal</span><span>{formatCurrency(sale.subTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Discount</span><span>-{formatCurrency(sale.discountTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-dashed border-ink/40 pt-0.5 text-sm font-bold">
              <span>TOTAL</span><span>{formatCurrency(sale.grandTotal)}</span>
            </div>
            <p className="pt-0.5">Payment: {sale.paymentMode}</p>
          </div>
          <div className="my-1 border-t border-dashed border-ink/40" />
          <p className="text-center text-[11px]">Thank you! Visit again 🙏</p>
        </div>
        <div className="no-print mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn-primary flex-1" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Print all today's bills as a single consolidated summary
// ---------------------------------------------------------------------------
function PrintAllModal({ bills, onClose }: { bills: Sale[]; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, []);

  const grandTotal = bills.reduce((s, b) => s + Number(b.grandTotal), 0);
  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return createPortal(
    <div className="receipt-modal fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="receipt-card card w-full max-w-sm">
        <div className="receipt-print text-sm">
          <div className="text-center">
            <h2 className="text-base font-bold">Indrayani Upahar Gruh</h2>
            <p className="text-[11px]">Daily Sales Summary — {today}</p>
            <p className="text-[11px]">Total Bills: {bills.length}</p>
          </div>
          <div className="my-1 border-t border-dashed border-ink/40" />
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-dashed border-ink/40">
                <th className="py-0.5 text-left font-semibold">Bill No</th>
                <th className="text-left font-semibold">Time</th>
                <th className="text-left font-semibold">Pay</th>
                <th className="text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {[...bills].reverse().map((b) => (
                <tr key={b.id} className="border-b border-dashed border-ink/20">
                  <td className="py-0.5 font-medium">{b.billNo}</td>
                  <td>{formatDateTime(b.billTime).split(" ")[1]}</td>
                  <td>{b.paymentMode}</td>
                  <td className="text-right">{formatCurrency(b.grandTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="my-1 border-t border-dashed border-ink/40" />
          <div className="flex justify-between text-sm font-bold">
            <span>DAY TOTAL</span>
            <span>{formatCurrency(grandTotal)}</span>
          </div>
          {/* Payment mode breakdown */}
          {(["CASH", "UPI", "CREDIT"] as PaymentMode[]).map((mode) => {
            const amt = bills.filter((b) => b.paymentMode === mode).reduce((s, b) => s + Number(b.grandTotal), 0);
            return amt > 0 ? (
              <div key={mode} className="flex justify-between text-[11px] text-muted">
                <span>{mode}</span><span>{formatCurrency(amt)}</span>
              </div>
            ) : null;
          })}
          <div className="my-1 border-t border-dashed border-ink/40" />
          <p className="text-center text-[11px]">Indrayani Upahar Gruh</p>
        </div>
        <div className="no-print mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => window.print()}>🖨 Print</button>
          <button className="btn-primary flex-1" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
