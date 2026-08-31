import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { useCategories, useUnits } from "../../api/queries";
import { MasterImport } from "../../components/MasterImport";

export function CategoriesUnits() {
  const queryClient = useQueryClient();
  const { data: categories } = useCategories();
  const { data: units } = useUnits();
  const [categoryName, setCategoryName] = useState("");
  const [unitName, setUnitName] = useState("");
  const [unitSymbol, setUnitSymbol] = useState("");

  const addCategory = useMutation({
    mutationFn: async () => api.post("/masters/categories", { name: categoryName }),
    onSuccess: () => {
      toast.success("Category added");
      setCategoryName("");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const addUnit = useMutation({
    mutationFn: async () => api.post("/masters/units", { name: unitName, symbol: unitSymbol }),
    onSuccess: () => {
      toast.success("Unit added");
      setUnitName("");
      setUnitSymbol("");
      queryClient.invalidateQueries({ queryKey: ["units"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleCategory = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => api.patch(`/masters/categories/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["categories"] }),
  });

  const toggleUnit = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => api.patch(`/masters/units/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["units"] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Categories & Units</h1>
        <p className="text-sm text-muted">Shared master data used by the Product Master</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold">Categories</h2>
          <MasterImport
            entity="categories"
            filename="categories-template.xlsx"
            hint="Download the template, one category name per row, then upload."
            invalidateKey={["categories"]}
          />
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              addCategory.mutate();
            }}
          >
            <input className="input" placeholder="e.g. Grocery" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={addCategory.isPending}>
              Add
            </button>
          </form>
          <table className="table-base">
            <tbody>
              {categories
                ?.filter((c) => !c.isFood)
                .map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                  <td className="text-right">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleCategory.mutate({ id: c.id, active: !c.active })}>
                      {c.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card space-y-3">
          <h2 className="font-semibold">Units</h2>
          <MasterImport
            entity="units"
            filename="units-template.xlsx"
            hint="Download the template, fill Name and Symbol per row, then upload."
            invalidateKey={["units"]}
          />
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              addUnit.mutate();
            }}
          >
            <input className="input" placeholder="Name e.g. Kilogram" value={unitName} onChange={(e) => setUnitName(e.target.value)} required />
            <input className="input !w-24" placeholder="KG" value={unitSymbol} onChange={(e) => setUnitSymbol(e.target.value)} required />
            <button className="btn-primary" type="submit" disabled={addUnit.isPending}>
              Add
            </button>
          </form>
          <table className="table-base">
            <tbody>
              {units?.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.name} ({u.symbol})
                  </td>
                  <td>{u.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                  <td className="text-right">
                    <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleUnit.mutate({ id: u.id, active: !u.active })}>
                      {u.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
