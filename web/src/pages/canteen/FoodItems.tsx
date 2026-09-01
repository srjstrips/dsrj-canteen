import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage, imageSrc } from "../../api/client";
import { useCategories, useFoodItems } from "../../api/queries";
import { Modal } from "../../components/Modal";
import { Product } from "../../types";
import { formatCurrency } from "../../lib/format";
import { MasterImport } from "../../components/MasterImport";

const PRESET_CATEGORIES = ["Breakfast", "Lunch / Dinner", "Snacks", "Sweet", "Beverage"];

export function FoodItems() {
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useFoodItems();
  const { data: categories } = useCategories();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ name: "", sellPrice: "", category: "" });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [newCategory, setNewCategory] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["categories"] });
  };

  const addCategory = useMutation({
    mutationFn: async () => api.post("/masters/products/food-category", { name: newCategory.trim() }),
    onSuccess: () => {
      toast.success("Category added");
      invalidate();
      setNewCategory("");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteCategory = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode?: "cascade" | "unlink" }) =>
      api.delete(`/masters/products/food-category/${id}${mode ? `?mode=${mode}` : ""}`),
    onSuccess: () => {
      toast.success("Category deleted");
      invalidate();
    },
    onError: (e, vars) => {
      const msg = apiErrorMessage(e);
      if (msg.includes("food items") && !vars.mode) {
        const cascade = window.confirm(
          `This category has food items.\n\nOK → Delete category AND its unbilled items\nCancel → Keep items, just remove category (items become uncategorized)`
        );
        deleteCategory.mutate({ id: vars.id, mode: cascade ? "cascade" : "unlink" });
      } else {
        toast.error(msg);
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, sellPrice: Number(form.sellPrice), category: form.category.trim() };
      const res = editing
        ? await api.patch<Product>(`/masters/products/food-item/${editing.id}`, payload)
        : await api.post<Product>("/masters/products/food-item", payload);
      if (imageFile) {
        const fd = new FormData();
        fd.append("image", imageFile);
        await api.post(`/masters/products/${res.data.id}/image`, fd);
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Food item updated" : "Food item added");
      invalidate();
      setOpen(false);
      setEditing(null);
      setForm({ name: "", sellPrice: "", category: "" });
      setImageFile(null);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Product) => api.patch(`/masters/products/food-item/${p.id}`, { active: !p.active }),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (p: Product) => api.delete(`/masters/products/food-item/${p.id}`),
    onSuccess: () => {
      toast.success("Food item deleted");
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function openEdit(p: Product) {
    setEditing(p);
    setForm({ name: p.name, sellPrice: String(Number(p.sellPrice ?? 0)), category: p.category?.name ?? "" });
    setImageFile(null);
    setOpen(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.category.trim()) return toast.error("Category is required");
    if (Number(form.sellPrice) < 0) return toast.error("Price cannot be negative");
    saveMutation.mutate();
  }

  // Group items by their meal category for the list.
  const grouped = (items ?? []).reduce<Record<string, Product[]>>((acc, p) => {
    const key = p.category?.name ?? "Uncategorized";
    (acc[key] ??= []).push(p);
    return acc;
  }, {});
  const foodCategoryNames = (categories ?? []).filter((c) => c.isFood).map((c) => c.name);
  const categoryOptions = Array.from(new Set([...PRESET_CATEGORIES, ...foodCategoryNames, ...Object.keys(grouped)]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Food Items (Menu)</h1>
          <p className="text-sm text-muted">Prepared food sold at the counter — just name &amp; price. These do not use canteen stock.</p>
        </div>
        <div className="flex gap-2">
          <MasterImport
            entity="food-items"
            filename="food-items-template.xlsx"
            hint="Columns: Name, Category, Price. Category is auto-created if new."
            invalidateKey={["products"]}
          />
          <button
            className="btn-primary"
            onClick={() => {
              setEditing(null);
              setForm({ name: "", sellPrice: "", category: "" });
              setImageFile(null);
              setOpen(true);
            }}
          >
            + New Food Item
          </button>
        </div>
      </div>

      <div className="card space-y-2">
        <h2 className="text-sm font-semibold">Categories</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCategory.trim()) return toast.error("Category name is required");
            addCategory.mutate();
          }}
        >
          <input className="input max-w-xs" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="New category e.g. Breakfast" />
          <button className="btn-secondary" type="submit" disabled={addCategory.isPending}>
            {addCategory.isPending ? "Adding…" : "Add Category"}
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(categories ?? [])
            .filter((c) => c.isFood)
            .map((c) => (
              <span key={c.id} className="badge-info inline-flex items-center gap-1">
                {c.name}
                <button
                  className="text-primary/70 hover:text-danger"
                  title="Delete category"
                  onClick={() => {
                    if (window.confirm(`Delete category "${c.name}"?`)) deleteCategory.mutate({ id: c.id, mode: undefined });
                  }}
                >
                  ✕
                </button>
              </span>
            ))}
          {/* Presets not yet created as real categories — shown as plain suggestions */}
          {PRESET_CATEGORIES.filter((p) => !(categories ?? []).some((c) => c.isFood && c.name.toLowerCase() === p.toLowerCase())).map((p) => (
            <span key={p} className="badge-info opacity-50" title="Not created yet — add a food item under it to create it">
              {p}
            </span>
          ))}
        </div>
      </div>

      {isLoading && <p className="text-muted">Loading…</p>}
      {!isLoading && (items?.length ?? 0) === 0 && <p className="card text-muted">No food items yet — add your menu items here.</p>}

      {Object.entries(grouped).map(([category, list]) => (
        <div key={category} className="card overflow-x-auto p-0">
          <h2 className="px-4 pt-3 text-sm font-semibold text-primary">{category}</h2>
          <table className="table-base mt-1">
            <thead>
              <tr>
                <th>Food Item</th>
                <th className="text-right">Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">
                    <div className="flex items-center gap-2">
                      {p.imageUrl ? (
                        <img src={imageSrc(p.imageUrl)} alt="" className="h-9 w-9 rounded-md border border-border object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted">🍽</span>
                      )}
                      {p.name}
                    </div>
                  </td>
                  <td className="text-right">{formatCurrency(p.sellPrice)}</td>
                  <td>{p.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                  <td className="space-x-2 whitespace-nowrap">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => openEdit(p)}>
                      Edit
                    </button>
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate(p)}>
                      {p.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs text-danger"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete "${p.name}"?`)) deleteMutation.mutate(p);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Edit Food Item" : "New Food Item"}>
        <form className="space-y-3" onSubmit={submit}>
          <div>
            <label className="label">Food Item Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Veg Meal, Chapati, Tea" />
          </div>
          <div>
            <label className="label">Category</label>
            <input
              className="input"
              list="food-categories"
              required
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="Breakfast, Lunch / Dinner, Snacks, Sweet…"
            />
            <datalist id="food-categories">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-muted">Pick from the list or type a new category.</p>
          </div>
          <div>
            <label className="label">Price (₹)</label>
            <input className="input" type="number" min={0} step="0.01" required value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} />
          </div>
          <div>
            <label className="label">Image</label>
            <div className="flex items-center gap-3">
              {(imageFile || editing?.imageUrl) && (
                <img
                  src={imageFile ? URL.createObjectURL(imageFile) : imageSrc(editing?.imageUrl)}
                  alt=""
                  className="h-14 w-14 rounded-lg border border-border object-cover"
                />
              )}
              <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </div>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save Food Item"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
