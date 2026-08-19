import { Router } from "express";
import { pool, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { Role } from "../../types/domain";
import { getDailySalesSummary } from "../canteen/billing.service";
import { purchaseVsSalesReport, wastageCostReport } from "../reports/reports.service";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

dashboardRouter.get(
  "/admin",
  requireRole(Role.ADMIN),
  asyncHandler(async (_req, res) => {
    const today = new Date();
    const dayFrom = startOfDay(today);
    const dayTo = endOfDay(today);
    const monthFrom = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthTo = endOfDay(today);

    const [storeValue, canteenValue, todaySales, monthSales, monthPurchases, wastage, productCount, userCount] = await Promise.all([
      queryOne<{ total: string | null }>(pool, "SELECT SUM(stock_value) AS total FROM store_stock_balances"),
      queryOne<{ total: string | null }>(pool, "SELECT SUM(stock_value) AS total FROM canteen_stock_balances"),
      getDailySalesSummary(dayFrom, dayTo),
      getDailySalesSummary(monthFrom, monthTo),
      purchaseVsSalesReport(monthFrom, monthTo),
      wastageCostReport(monthFrom, monthTo),
      queryOne<{ count: string }>(pool, "SELECT COUNT(*) AS count FROM products WHERE active = TRUE"),
      queryOne<{ count: string }>(pool, "SELECT COUNT(*) AS count FROM users WHERE active = TRUE"),
    ]);

    res.json({
      storeStockValue: storeValue?.total ?? 0,
      canteenStockValue: canteenValue?.total ?? 0,
      todaysSales: todaySales.totalSales,
      monthlySales: monthSales.totalSales,
      monthlyPurchases: monthPurchases.totalPurchaseValue,
      monthlyWastageValue: wastage.reduce((sum, w) => sum + Number(w.value), 0),
      activeProducts: Number(productCount?.count ?? 0),
      activeUsers: Number(userCount?.count ?? 0),
    });
  })
);
