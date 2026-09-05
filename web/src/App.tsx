import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { Layout } from "./layout/Layout";
import { Login } from "./pages/auth/Login";
import { AdminDashboard } from "./pages/admin/AdminDashboard";
import { Users } from "./pages/admin/Users";
import { Products } from "./pages/admin/Products";
import { CategoriesUnits } from "./pages/admin/CategoriesUnits";
import { Suppliers } from "./pages/admin/Suppliers";
import { Adjustments } from "./pages/admin/Adjustments";
import { ManagementReports } from "./pages/admin/ManagementReports";
import { BillingAccounts } from "./pages/admin/BillingAccounts";
import { ResetData } from "./pages/admin/ResetData";
import { PlaceOrders } from "./pages/hod/PlaceOrders";
import { Approvals } from "./pages/hod/Approvals";
import { Statements } from "./pages/hod/Statements";
import { ManagedOrders } from "./pages/canteen/ManagedOrders";
import { ContractorTokens } from "./pages/canteen/ContractorTokens";
import { ContractorPortal } from "./pages/contractor/ContractorPortal";
import { StoreDashboard } from "./pages/store/StoreDashboard";
import { StockInward } from "./pages/store/StockInward";
import { StoreStock } from "./pages/store/StoreStock";
import { StockIssue } from "./pages/store/StockIssue";
import { StoreReturn } from "./pages/store/StoreReturn";
import { StoreLedger } from "./pages/store/StoreLedger";
import { StoreReports } from "./pages/store/StoreReports";
import { CanteenDashboard } from "./pages/canteen/CanteenDashboard";
import { ReceivedStock } from "./pages/canteen/ReceivedStock";
import { CanteenStock } from "./pages/canteen/CanteenStock";
import { Billing } from "./pages/canteen/Billing";
import { FoodItems } from "./pages/canteen/FoodItems";
import { DailySales } from "./pages/canteen/DailySales";
import { Consumption } from "./pages/canteen/Consumption";
import { Wastage } from "./pages/canteen/Wastage";
import { CanteenReports } from "./pages/canteen/CanteenReports";
import { Notifications } from "./pages/notifications/Notifications";
import { wireAutoSync, syncPendingSales } from "./offline/offlineQueue";

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "STORE") return <Navigate to="/store/dashboard" replace />;
  if (user.role === "CANTEEN") return <Navigate to="/canteen/dashboard" replace />;
  if (user.role === "HOD") return <Navigate to="/hod/place-orders" replace />;
  if (user.role === "CONTRACTOR") return <Navigate to="/contractor/portal" replace />;
  return <Navigate to="/admin/dashboard" replace />;
}

export function App() {
  useEffect(() => {
    wireAutoSync();
    if (navigator.onLine) syncPendingSales();
  }, []);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route path="/" element={<HomeRedirect />} />

          <Route element={<ProtectedRoute allow={["ADMIN"]} />}>
            <Route path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/admin/users" element={<Users />} />
            <Route path="/admin/products" element={<Products />} />
            <Route path="/admin/categories" element={<CategoriesUnits />} />
            <Route path="/admin/suppliers" element={<Suppliers />} />
            <Route path="/admin/adjustments" element={<Adjustments />} />
            <Route path="/admin/reports" element={<ManagementReports />} />
            <Route path="/admin/billing-accounts" element={<BillingAccounts />} />
            <Route path="/admin/reset-data" element={<ResetData />} />
          </Route>

          <Route element={<ProtectedRoute allow={["HOD"]} />}>
            <Route path="/hod/place-orders" element={<PlaceOrders />} />
            <Route path="/hod/approvals" element={<Approvals />} />
          </Route>
          <Route element={<ProtectedRoute allow={["HOD", "ADMIN"]} />}>
            <Route path="/hod/statements" element={<Statements />} />
          </Route>

          <Route element={<ProtectedRoute allow={["STORE"]} />}>
            <Route path="/store/dashboard" element={<StoreDashboard />} />
            <Route path="/store/stock-inward" element={<StockInward />} />
            <Route path="/store/stock-issue" element={<StockIssue />} />
            <Route path="/store/stock-return" element={<StoreReturn />} />
            <Route path="/store/ledger" element={<StoreLedger />} />
            <Route path="/store/reports" element={<StoreReports />} />
          </Route>
          <Route element={<ProtectedRoute allow={["STORE", "CANTEEN"]} />}>
            <Route path="/store/stock" element={<StoreStock />} />
          </Route>

          <Route element={<ProtectedRoute allow={["CONTRACTOR"]} />}>
            <Route path="/contractor/portal" element={<ContractorPortal />} />
          </Route>

          <Route path="/notifications" element={<Notifications />} />

          <Route element={<ProtectedRoute allow={["CANTEEN"]} />}>
            <Route path="/canteen/dashboard" element={<CanteenDashboard />} />
            <Route path="/canteen/received-stock" element={<ReceivedStock />} />
            <Route path="/canteen/stock" element={<CanteenStock />} />
            <Route path="/canteen/billing" element={<Billing />} />
            <Route path="/canteen/food-items" element={<FoodItems />} />
            <Route path="/canteen/daily-sales" element={<DailySales />} />
            <Route path="/canteen/consumption" element={<Consumption />} />
            <Route path="/canteen/wastage" element={<Wastage />} />
            <Route path="/canteen/managed-orders" element={<ManagedOrders />} />
            <Route path="/canteen/contractor-tokens" element={<ContractorTokens />} />
            <Route path="/canteen/reports" element={<CanteenReports />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
