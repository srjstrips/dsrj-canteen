// Plain TypeScript stand-ins for what Prisma used to generate from the
// schema's `enum` blocks. Each mirrors a Postgres ENUM type created in
// server/db/migrations/0001_init.sql — keep them in sync if that ever changes.

export const Role = { ADMIN: "ADMIN", STORE: "STORE", CANTEEN: "CANTEEN", HOD: "HOD" } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const PaymentMode = { CASH: "CASH", UPI: "UPI", CREDIT: "CREDIT" } as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const StoreLedgerTxnType = { OPENING: "OPENING", INWARD: "INWARD", ISSUE: "ISSUE", RETURN: "RETURN", ADJUSTMENT: "ADJUSTMENT" } as const;
export type StoreLedgerTxnType = (typeof StoreLedgerTxnType)[keyof typeof StoreLedgerTxnType];

export const CanteenLedgerTxnType = {
  RECEIVED: "RECEIVED",
  SALE: "SALE",
  CONSUMPTION: "CONSUMPTION",
  WASTAGE: "WASTAGE",
  RETURN: "RETURN",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type CanteenLedgerTxnType = (typeof CanteenLedgerTxnType)[keyof typeof CanteenLedgerTxnType];

export const WastageReason = {
  SPOILAGE: "SPOILAGE",
  EXPIRED: "EXPIRED",
  PREPARATION_WASTE: "PREPARATION_WASTE",
  DAMAGED: "DAMAGED",
  EXCESS_PREPARATION: "EXCESS_PREPARATION",
  OTHER: "OTHER",
} as const;
export type WastageReason = (typeof WastageReason)[keyof typeof WastageReason];

export const StockArea = { STORE: "STORE", CANTEEN: "CANTEEN" } as const;
export type StockArea = (typeof StockArea)[keyof typeof StockArea];

export const SaleStatus = { COMPLETED: "COMPLETED", CANCELLED: "CANCELLED" } as const;
export type SaleStatus = (typeof SaleStatus)[keyof typeof SaleStatus];

// Managed orders — HOD/HR module (OT / Guest / Contractor). See 0002 migration.
export const ManagedOrderType = { OT: "OT", GUEST: "GUEST", CONTRACTOR: "CONTRACTOR" } as const;
export type ManagedOrderType = (typeof ManagedOrderType)[keyof typeof ManagedOrderType];

export const ManagedOrderStatus = { PLACED: "PLACED", SERVED: "SERVED", CANCELLED: "CANCELLED" } as const;
export type ManagedOrderStatus = (typeof ManagedOrderStatus)[keyof typeof ManagedOrderStatus];

export const BillingAccountType = { COMPANY: "COMPANY", CONTRACTOR: "CONTRACTOR" } as const;
export type BillingAccountType = (typeof BillingAccountType)[keyof typeof BillingAccountType];

export const ExtraStatus = { PENDING: "PENDING", CONFIRMED: "CONFIRMED", REJECTED: "REJECTED" } as const;
export type ExtraStatus = (typeof ExtraStatus)[keyof typeof ExtraStatus];
