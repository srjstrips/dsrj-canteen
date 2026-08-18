import { useEffect, useState } from "react";
import { api, apiErrorMessage } from "../api/client";
import { dbPromise, QueuedSale, QueuedSaleItem } from "./db";
import { PaymentMode, Sale } from "../types";

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => l());
}

function genClientRef(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function queueSaleOffline(input: {
  items: QueuedSaleItem[];
  paymentMode: PaymentMode;
  customerRef?: string;
}): Promise<QueuedSale> {
  const record: QueuedSale = {
    clientRef: genClientRef(),
    items: input.items,
    paymentMode: input.paymentMode,
    customerRef: input.customerRef,
    billDate: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  const db = await dbPromise;
  await db.put("pendingSales", record);
  notify();
  return record;
}

export async function listPendingSales(): Promise<QueuedSale[]> {
  const db = await dbPromise;
  return db.getAll("pendingSales");
}

export async function removePendingSale(clientRef: string) {
  const db = await dbPromise;
  await db.delete("pendingSales", clientRef);
  notify();
}

/** Attempts to push every queued offline bill to the server. Safe to call
 * repeatedly (e.g. on reconnect) — each bill carries its own clientRef so a
 * bill already accepted by the server is never double-posted (see
 * billing.service.ts createSale). */
export async function syncPendingSales(): Promise<{ synced: number; failed: number }> {
  const pending = await listPendingSales();
  let synced = 0;
  let failed = 0;

  for (const sale of pending) {
    try {
      await api.post<Sale>("/canteen/sales", {
        items: sale.items,
        paymentMode: sale.paymentMode,
        customerRef: sale.customerRef,
        billDate: sale.billDate,
        clientRef: sale.clientRef,
      });
      await removePendingSale(sale.clientRef);
      synced += 1;
    } catch (error) {
      failed += 1;
      const db = await dbPromise;
      await db.put("pendingSales", { ...sale, status: "failed", errorMessage: apiErrorMessage(error) });
      notify();
    }
  }
  return { synced, failed };
}

let syncWired = false;
export function wireAutoSync() {
  if (syncWired) return;
  syncWired = true;
  window.addEventListener("online", () => {
    syncPendingSales();
  });
  // Also retry periodically in case 'online' fired before the server was
  // actually reachable (captive portals, flaky connections).
  setInterval(() => {
    if (navigator.onLine) syncPendingSales();
  }, 30_000);
}

export function usePendingSyncCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      listPendingSales().then((rows) => {
        if (mounted) setCount(rows.length);
      });
    };
    refresh();
    listeners.add(refresh);
    return () => {
      mounted = false;
      listeners.delete(refresh);
    };
  }, []);

  return count;
}
