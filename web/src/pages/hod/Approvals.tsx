import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";
import { formatCurrency, formatQty } from "../../lib/format";
import { ManagedOrder } from "../../types";

export function Approvals() {
  const queryClient = useQueryClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["managed-pending-extras"],
    queryFn: async () => (await api.get<ManagedOrder[]>("/managed/extras/pending")).data,
  });

  const resolve = useMutation({
    mutationFn: async ({ itemId, confirm }: { itemId: string; confirm: boolean }) =>
      api.post(`/managed/extras/${itemId}/resolve`, { confirm }),
    onSuccess: (_res, vars) => {
      toast.success(vars.confirm ? "Extra confirmed" : "Extra rejected");
      queryClient.invalidateQueries({ queryKey: ["managed-pending-extras"] });
      queryClient.invalidateQueries({ queryKey: ["managed-orders"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const pending = orders?.filter((o) => o.items.some((i) => i.isExtra && i.extraStatus === "PENDING")) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Extra Approvals</h1>
        <p className="text-sm text-muted">Confirm or reject extra food recorded by the canteen. Confirmed extras are billed; rejected extras are dismissed.</p>
      </div>

      {isLoading && <p className="text-muted">Loading…</p>}
      {!isLoading && pending.length === 0 && <p className="card text-muted">No extras awaiting approval.</p>}

      {pending.map((o) => (
        <div key={o.id} className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-semibold">
                {o.dinerName} <span className="text-muted">· {o.orderNo}</span>
              </p>
              <p className="text-xs text-muted">
                {o.orderType} · {o.account.name} {o.shift ? `· ${o.shift}` : ""}
              </p>
            </div>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Extra Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {o.items
                .filter((i) => i.isExtra && i.extraStatus === "PENDING")
                .map((i) => (
                  <tr key={i.id}>
                    <td>{i.product.name}</td>
                    <td className="text-right">
                      {formatQty(i.quantity)} {i.product.unit.symbol}
                    </td>
                    <td className="text-right">{formatCurrency(i.amount)}</td>
                    <td className="space-x-2 whitespace-nowrap text-right">
                      <button
                        className="btn-primary !px-3 !py-1 text-xs"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ itemId: i.id, confirm: true })}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn-secondary !px-3 !py-1 text-xs"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate({ itemId: i.id, confirm: false })}
                      >
                        Reject
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
