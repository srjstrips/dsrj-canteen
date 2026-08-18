import { Role } from "../types";

export interface NavItem {
  label: string;
  to: string;
  roles: Role[]; // roles (besides ADMIN, who always sees everything) that can see this item
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Admin Dashboard", to: "/admin/dashboard", roles: [] },
      { label: "Store Dashboard", to: "/store/dashboard", roles: ["STORE"] },
      { label: "Canteen Dashboard", to: "/canteen/dashboard", roles: ["CANTEEN"] },
    ],
  },
  {
    title: "Store",
    items: [
      { label: "Stock Inward", to: "/store/stock-inward", roles: ["STORE"] },
      { label: "Store Stock", to: "/store/stock", roles: ["STORE", "CANTEEN"] },
      { label: "Stock Issue to Canteen", to: "/store/stock-issue", roles: ["STORE"] },
      { label: "Stock Ledger", to: "/store/ledger", roles: ["STORE"] },
      { label: "Store Reports", to: "/store/reports", roles: ["STORE"] },
    ],
  },
  {
    title: "Canteen",
    items: [
      { label: "Received Stock", to: "/canteen/received-stock", roles: ["CANTEEN"] },
      { label: "Canteen Stock", to: "/canteen/stock", roles: ["CANTEEN"] },
      { label: "Billing / POS", to: "/canteen/billing", roles: ["CANTEEN"] },
      { label: "Daily Sales", to: "/canteen/daily-sales", roles: ["CANTEEN"] },
      { label: "Consumption", to: "/canteen/consumption", roles: ["CANTEEN"] },
      { label: "Wastage", to: "/canteen/wastage", roles: ["CANTEEN"] },
      { label: "Canteen Reports", to: "/canteen/reports", roles: ["CANTEEN"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Users", to: "/admin/users", roles: [] },
      { label: "Products", to: "/admin/products", roles: [] },
      { label: "Categories & Units", to: "/admin/categories", roles: [] },
      { label: "Suppliers", to: "/admin/suppliers", roles: [] },
      { label: "Stock Adjustments", to: "/admin/adjustments", roles: [] },
      { label: "Management Reports", to: "/admin/reports", roles: [] },
    ],
  },
];

export function visibleSections(role: Role): NavSection[] {
  return navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => role === "ADMIN" || item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);
}
