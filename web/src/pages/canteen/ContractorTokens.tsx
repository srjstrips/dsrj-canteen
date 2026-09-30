import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "../../api/client";

interface ContractorBalance {
  accountId: string;
  name: string;
  balance: number;
}

interface DeductState {
  [accountId: string]: string;
}

export function ContractorTokens() {
  const queryClient = useQueryClient();
  const [deductQty, setDeductQty] = useState<DeductState>({});

  const { data: contractors, isLoading } = useQuery({
    queryKey: ["token-balances"],
    queryFn: async () => (await api.get<ContractorBalance[]>("/tokens/balances")).data,
    refetchInterval: 60000,
  });

  const deductMutation = useMutation({
    mutationFn: async ({ accountId, quantity }: { accountId: string; quantity: number }) =>
      api.post<{ balance: number }>(`/tokens/${accountId}/deduct`, { quantity }),
    onSuccess: (res, { accountId }) => {
      toast.success(`Deducted — new balance: ${res.data.balance} tokens`);
      setDeductQty((prev) => ({ ...prev, [accountId]: "" }));
      queryClient.invalidateQueries({ queryKey: ["token-balances"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const handleDeduct = (accountId: string) => {
    const qty = parseInt(deductQty[accountId] ?? "", 10);
    if (!qty || qty <= 0) return toast.error("Enter a valid number of labourers");
    deductMutation.mutate({ accountId, quantity: qty });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">Contractor Tokens</h1>
        <p className="text-sm text-muted">Enter today's labourer count for each contractor and deduct tokens.</p>
      </div>

      {isLoading && <p className="text-sm text-muted">Loading…</p>}

      {!isLoading && (!contractors || contractors.length === 0) && (
        <div className="card py-10 text-center text-muted">No contractor accounts found.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(contractors ?? []).map((c) => (
          <div key={c.accountId} className="card space-y-4">
            <div>
              <p className="font-semibold text-base">{c.name}</p>
              <p className="text-sm text-muted mt-0.5">
                Balance:{" "}
                <span className={`font-bold ${c.balance <= 0 ? "text-danger" : "text-primary"}`}>
                  {c.balance} tokens
                </span>
              </p>
            </div>

            <div className="flex gap-2">
              <input
                className="input flex-1"
                type="number"
                min={1}
                placeholder="Labourers today"
                value={deductQty[c.accountId] ?? ""}
                onChange={(e) =>
                  setDeductQty((prev) => ({ ...prev, [c.accountId]: e.target.value }))
                }
                onKeyDown={(e) => e.key === "Enter" && handleDeduct(c.accountId)}
              />
              <button
                className="btn-primary"
                disabled={deductMutation.isPending || c.balance <= 0}
                onClick={() => handleDeduct(c.accountId)}
              >
                Deduct
              </button>
            </div>

            {c.balance <= 0 && (
              <p className="text-xs text-danger">No tokens remaining — top up required.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
