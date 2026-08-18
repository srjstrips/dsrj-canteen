export type Role = "ADMIN" | "STORE" | "CANTEEN";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
}

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  active: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string | null;
  mobile?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  paymentTerms?: string | null;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  categoryId: string;
  unitId: string;
  category: Category;
  unit: Unit;
  minStockLevel: string;
  reorderLevel: string;
  trackCanteenStock: boolean;
  sellPrice?: string | null;
  active: boolean;
}

export interface StoreStockRow {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  openingQty: string;
  inwardQty: string;
  availableQty: string;
  avgRate: string;
  issueQty: string;
  balanceQty: string;
  stockValue: string;
  isLowStock: boolean;
}

export interface CanteenStockRow {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  openingQty: string;
  received: string;
  consumption: string;
  sales: string;
  wastage: string;
  adjustment: string;
  balanceQty: string;
  avgRate: string;
  stockValue: string;
  isLowStock: boolean;
}

export type PaymentMode = "CASH" | "UPI" | "CREDIT";

export interface SaleItem {
  id: string;
  productId: string;
  product: Product;
  quantity: string;
  rate: string;
  discount: string;
  amount: string;
}

export interface Sale {
  id: string;
  billNo: string;
  billDate: string;
  billTime: string;
  subTotal: string;
  discountTotal: string;
  grandTotal: string;
  paymentMode: PaymentMode;
  status: "COMPLETED" | "CANCELLED";
  items: SaleItem[];
  createdBy?: { id: string; name: string };
  pendingSync?: boolean;
}
