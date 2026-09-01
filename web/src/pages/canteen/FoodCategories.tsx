import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";

interface FoodCategory {
  id: string;
  name: string;
  active: boolean;
  productCount: number;
}

function useFoodCategories() {
  return useQuery<FoodCategory[]>({
    queryKey: ["food-categories"],
    queryFn: async () => (await api.get("/masters/products/food-categories")).data,
  });
}

export function FoodCategories() {
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useFoodCategories();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["food-categories"] });
    queryClient.invalidateQueries({ queryKey: ["categories"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const addCategory = useMutation({
    mutationFn: async () => api.post("/masters/products/food-category", { name: newName.trim() }),
    onSuccess: () => {
      toast.success("Category added");
      setNewName("");
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const renameCategory = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) =>
      api.patch(`/masters/products/food-category/${id}`, { name }),
    onSuccess: () => {
      toast.success("Category renamed");
      setEditingId(null);
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleCategory = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/masters/products/food-category/${id}`, { active }),
    onSuccess: invalidate,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const deleteCategory = useMutation({
    mutationFn: async ({ id, mode }: { id: string; mode?: "cascade" | "unlink" }) =>
      api.delete(`/masters/products/food-category/${id}${mode ? `?mode=${mode}` : ""}`),
    onSuccess: () => {
      toast.success("Category deleted");
      invalidate();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function handleDelete(cat: FoodCategory) {
    if (cat.productCount === 0) {
      if (window.confirm(`Delete category "${cat.name}"?`)) {
        deleteCategory.mutate({ id: cat.id });
      }
      return;
    }

    const choice = window.confirm(
      `"${cat.name}" has ${cat.productCount} active food item(s).\n\n` +
        `OK → Delete category AND its unbilled food items (billed items kept for history)\n` +
        `Cancel → Keep food items but remove category (items become uncategorized)`
    );

    if (choice) {
      // OK = cascade delete
      if (window.confirm(`Are you sure? This will permanently delete unbilled food items under "${cat.name}".`)) {
        deleteCategory.mutate({ id: cat.id, mode: "cascade" });
      }
    } else {
      // Cancel = unlink (keep items, remove category)
      if (window.confirm(`Move all items under "${cat.name}" to uncategorized and delete the category?`)) {
        deleteCategory.mutate({ id: cat.id, mode: "unlink" });
      }
    }
  }

  function startEdit(cat: FoodCategory) {
    setEditingId(cat.id);
    setEditingName(cat.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingName("");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Food Categories</h1>
        <p className="text-sm text-muted">Manage categories used for menu items. Deleting a category with items lets you cascade-delete or unlink them.</p>
      </div>

      {/* Add category */}
      <div className="card">
        <h2 className="mb-3 font-semibold">Add New Category</h2>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return toast.error("Name is required");
            addCategory.mutate();
          }}
        >
          <input
            className="input max-w-xs"
            placeholder="e.g. Breakfast"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={addCategory.isPending}>
            {addCategory.isPending ? "Adding…" : "Add Category"}
          </button>
        </form>
      </div>

      {/* Category table */}
      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Category Name</th>
              <th>Active Items</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && (categories?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-muted">
                  No food categories yet.
                </td>
              </tr>
            )}
            {categories?.map((cat) => (
              <tr key={cat.id}>
                <td>
                  {editingId === cat.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!editingName.trim()) return toast.error("Name is required");
                        renameCategory.mutate({ id: cat.id, name: editingName.trim() });
                      }}
                    >
                      <input
                        className="input !h-7 !py-0 text-sm"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                      />
                      <button className="btn-primary !px-2 !py-1 text-xs" type="submit" disabled={renameCategory.isPending}>
                        Save
                      </button>
                      <button className="btn-secondary !px-2 !py-1 text-xs" type="button" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <span className="font-medium">{cat.name}</span>
                  )}
                </td>
                <td>
                  <span className={`font-semibold ${cat.productCount > 0 ? "text-primary" : "text-muted"}`}>
                    {cat.productCount}
                  </span>
                </td>
                <td>
                  {cat.active ? (
                    <span className="badge-success">Active</span>
                  ) : (
                    <span className="badge-danger">Inactive</span>
                  )}
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    {editingId !== cat.id && (
                      <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => startEdit(cat)}>
                        Rename
                      </button>
                    )}
                    <button
                      className="btn-secondary !px-2 !py-1 text-xs"
                      onClick={() => toggleCategory.mutate({ id: cat.id, active: !cat.active })}
                    >
                      {cat.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      className="!px-2 !py-1 text-xs font-medium text-danger hover:underline"
                      onClick={() => handleDelete(cat)}
                      disabled={deleteCategory.isPending}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
