import { DBSchema, openDB } from "idb";
import { PaymentMode } from "../types";

export interface QueuedSaleItem {
  productId: string;
  quantity: number;
  rate: number;
  discount?: number;
}

export interface QueuedSale {
  clientRef: string;
  items: QueuedSaleItem[];
  paymentMode: PaymentMode;
  customerRef?: string;
  billDate: string; // ISO, captured at time of sale even if synced later
  createdAt: string;
  status: "pending" | "failed";
  errorMessage?: string;
}

interface DsrjOfflineDB extends DBSchema {
  pendingSales: {
    key: string;
    value: QueuedSale;
  };
}

export const dbPromise = openDB<DsrjOfflineDB>("dsrj-offline", 1, {
  upgrade(db) {
    db.createObjectStore("pendingSales", { keyPath: "clientRef" });
  },
});
