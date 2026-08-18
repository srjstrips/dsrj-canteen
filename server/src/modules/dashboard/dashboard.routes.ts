import { Router } from "express";
import { Role } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
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
      prisma.storeStockBalance.aggregate({ _sum: { stockValue: true } }),
      prisma.canteenStockBalance.aggregate({ _sum: { stockValue: true } }),
      getDailySalesSummary(dayFrom, dayTo),
      getDailySalesSummary(monthFrom, monthTo),
      purchaseVsSalesReport(monthFrom, monthTo),
      wastageCostReport(monthFrom, monthTo),
      prisma.product.count({ where: { active: true } }),
      prisma.user.count({ where: { active: true } }),
    ]);

    res.json({
      storeStockValue: storeValue._sum.stockValue ?? 0,
      canteenStockValue: canteenValue._sum.stockValue ?? 0,
      todaysSales: todaySales.totalSales,
      monthlySales: monthSales.totalSales,
      monthlyPurchases: monthPurchases.totalPurchaseValue,
      monthlyWastageValue: wastage.reduce((sum, w) => sum + Number(w.value), 0),
      activeProducts: productCount,
      activeUsers: userCount,
    });
  })
);
