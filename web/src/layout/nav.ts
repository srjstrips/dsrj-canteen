import {
  LayoutDashboard,
  Store,
  UtensilsCrossed,
  PackagePlus,
  Package,
  Send,
  Undo2,
  BookOpen,
  BarChart3,
  Inbox,
  Soup,
  Sandwich,
  ShoppingCart,
  ClipboardList,
  Wallet,
  Flame,
  Trash2,
  LineChart,
  FilePlus2,
  CheckCircle2,
  Calculator,
  Users,
  Boxes,
  Tags,
  Truck,
  Building2,
  Scale,
  RotateCcw,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { Role } from "../types";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon; // outline icon shown in the sidebar
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
      { label: "Admin Dashboard", to: "/admin/dashboard", icon: LayoutDashboard, roles: [] },
      { label: "Store Dashboard", to: "/store/dashboard", icon: Store, roles: ["STORE"] },
      { label: "Canteen Dashboard", to: "/canteen/dashboard", icon: UtensilsCrossed, roles: ["CANTEEN"] },
    ],
  },
  {
    title: "Store",
    items: [
      { label: "Stock Inward", to: "/store/stock-inward", icon: PackagePlus, roles: ["STORE"] },
      { label: "Store Stock", to: "/store/stock", icon: Package, roles: ["STORE", "CANTEEN"] },
      { label: "Stock Issue to Canteen", to: "/store/stock-issue", icon: Send, roles: ["STORE"] },
      { label: "Return Stock from Canteen", to: "/store/stock-return", icon: Undo2, roles: ["STORE"] },
      { label: "Stock Ledger", to: "/store/ledger", icon: BookOpen, roles: ["STORE"] },
      { label: "Store Reports", to: "/store/reports", icon: BarChart3, roles: ["STORE"] },
    ],
  },
  {
    title: "Canteen",
    items: [
      { label: "Received Stock", to: "/canteen/received-stock", icon: Inbox, roles: ["CANTEEN"] },
      { label: "Canteen Stock", to: "/canteen/stock", icon: Soup, roles: ["CANTEEN"] },
      { label: "Food Items (Menu)", to: "/canteen/food-items", icon: Sandwich, roles: ["CANTEEN"] },
      { label: "Billing / POS", to: "/canteen/billing", icon: ShoppingCart, roles: ["CANTEEN"] },
      { label: "OT / Guest / Contractor Orders", to: "/canteen/managed-orders", icon: ClipboardList, roles: ["CANTEEN"] },
      { label: "Contractor Tokens", to: "/canteen/contractor-tokens", icon: Ticket, roles: ["CANTEEN"] },
      { label: "Daily Sales", to: "/canteen/daily-sales", icon: Wallet, roles: ["CANTEEN"] },
      { label: "Consumption", to: "/canteen/consumption", icon: Flame, roles: ["CANTEEN"] },
      { label: "Wastage", to: "/canteen/wastage", icon: Trash2, roles: ["CANTEEN"] },
      { label: "Canteen Reports", to: "/canteen/reports", icon: LineChart, roles: ["CANTEEN"] },
    ],
  },
  {
    title: "HOD / HR",
    items: [
      { label: "Place Orders", to: "/hod/place-orders", icon: FilePlus2, roles: ["HOD"] },
      { label: "Extra Approvals", to: "/hod/approvals", icon: CheckCircle2, roles: ["HOD"] },
      { label: "Monthly Statements", to: "/hod/statements", icon: Calculator, roles: ["HOD"] },
    ],
  },
  {
    title: "Contractor",
    items: [
      { label: "My Token Balance", to: "/contractor/portal", icon: Ticket, roles: ["CONTRACTOR"] },
    ],
  },
  {
    title: "Administration",
    items: [
      { label: "Users", to: "/admin/users", icon: Users, roles: [] },
      { label: "Products", to: "/admin/products", icon: Boxes, roles: [] },
      { label: "Categories & Units", to: "/admin/categories", icon: Tags, roles: [] },
      { label: "Suppliers", to: "/admin/suppliers", icon: Truck, roles: [] },
      { label: "Billing Accounts", to: "/admin/billing-accounts", icon: Building2, roles: [] },
      { label: "Stock Adjustments", to: "/admin/adjustments", icon: Scale, roles: [] },
      { label: "Management Reports", to: "/admin/reports", icon: BarChart3, roles: [] },
      { label: "Reset Data", to: "/admin/reset-data", icon: RotateCcw, roles: [] },
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
