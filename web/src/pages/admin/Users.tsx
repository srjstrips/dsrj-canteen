import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { Modal } from "../../components/Modal";
import { AuthUser, Role } from "../../types";
import { formatDate } from "../../lib/format";

export function Users() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "STORE" as Role });

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<(AuthUser & { active: boolean; createdAt: string })[]>("/admin/users")).data,
  });

  const createMutation = useMutation({
    mutationFn: async () => api.post("/admin/users", form),
    onSuccess: () => {
      toast.success("User created");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      setForm({ name: "", email: "", password: "", role: "STORE" });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => api.patch(`/admin/users/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Users</h1>
          <p className="text-sm text-muted">Create users and assign module-wise roles</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          + New User
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6}>Loading…</td>
              </tr>
            )}
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>{u.active ? <span className="badge-success">Active</span> : <span className="badge-danger">Inactive</span>}</td>
                <td>{formatDate(u.createdAt)}</td>
                <td>
                  <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => toggleActive.mutate({ id: u.id, active: !u.active })}>
                    {u.active ? "Deactivate" : "Activate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New User">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              minLength={8}
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="ADMIN">Admin</option>
              <option value="STORE">Store User</option>
              <option value="CANTEEN">Canteen Manager</option>
            </select>
          </div>
          <button className="btn-primary w-full" type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create User"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
