import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useCategories, useProducts, useUnits } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { Product } from "../../types";

const emptyForm = {
  name: "",
  categoryId: "",
  unitId: "",
  minStockLevel: "0",
  reorderLevel: "0",
  trackCanteenStock: true,
  sellPrice: "",
};

export function Products() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: products, isLoading } = useProducts(false);
  const { data: categories } = useCategories();
  const { data: units } = useUnits();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        categoryId: form.categoryId,
        unitId: form.unitId,
        minStockLevel: Number(form.minStockLevel),
        reorderLevel: Number(form.reorderLevel),
        trackCanteenStock: form.trackCanteenStock,
        sellPrice: form.sellPrice ? Number(form.sellPrice) : null,
      };
      if (editing) return api.patch(`/masters/products/${editing.id}`, payload);
      return api.post("/masters/products", payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Product updated" : "Product created");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      closeModal();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) => api.patch(`/masters/products/${p.id}`, { active: !p.active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(p: Product) {
    setEditing(p);
    setForm({
      name: p.name,
      categoryId: p.categoryId,
      unitId: p.unitId,
      minStockLevel: p.minStockLevel,
      reorderLevel: p.reorderLevel,
      trackCanteenStock: p.trackCanteenStock,
      sellPrice: p.sellPrice ?? "",
    });
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    setEditing(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Product Master</h1>
          <p className="text-sm text-muted">Centralized product list used everywhere via dropdown — no free-typing product names</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          + New Product
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Min Stock</th>
              <th>Reorder Level</th>
              <th>Sell Price</th>
              <th>Canteen Stock Tracked</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9}>Loading…</td>
              </tr>
            )}
            {products?.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.name}</td>
                <td>{p.category.name}</td>
                <td>{p.unit.symbol}</td>
                <td>{p.minStockLevel}</td>
                <td>{p.reorderLevel}</td>
                <td>{p.sellPrice ?? "—"}</td>
                <td>{p.trackCanteenStock ? "Yes" : "No (ingredient)"}</td>
                <td>{p.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(p)}>
                    Edit
                  </button>
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate(p)}>
                    {p.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeModal} title={editing ? "Edit Product" : "New Product"}>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Product Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Category</label>
              <select className="input" required value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">Select…</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Unit</label>
              <select className="input" required value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
                <option value="">Select…</option>
                {units?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.symbol})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Minimum Stock Level</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.001"
                value={form.minStockLevel}
                onChange={(e) => setForm({ ...form, minStockLevel: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Reorder Level</label>
              <input
                className="input"
                type="number"
                min={0}
                step="0.001"
                value={form.reorderLevel}
                onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Sell Price (for direct-sale / POS products)</label>
            <input className="input" type="number" min={0} step="0.01" value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.trackCanteenStock}
              onChange={(e) => setForm({ ...form, trackCanteenStock: e.target.checked })}
            />
            Draw down Canteen stock 1:1 when sold (uncheck for made-to-order items whose ingredients are tracked via Consumption instead)
          </label>
          <button className="btn-primary w-full" type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save Product"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
