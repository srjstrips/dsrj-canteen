import { Router } from "express";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getStoreStockSummary } from "../store/store.service";
import { getCanteenStockSummary } from "../canteen/canteen.service";
import { getDailySalesSummary } from "../canteen/billing.service";
import {
  averageRateReport,
  consumptionReport,
  foodCostReport,
  lowStockReport,
  monthlyCanteenPerformance,
  paymentModeReport,
  purchaseValueReport,
  purchaseVsSalesReport,
  stockValueReport,
  supplierWisePurchaseReport,
  wastageCostReport,
} from "./reports.service";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function rangeFromQuery(query: Record<string, string | undefined>) {
  const today = new Date();
  return {
    from: query.from ? new Date(query.from) : startOfDay(new Date(today.getFullYear(), today.getMonth(), 1)),
    to: query.to ? new Date(query.to) : endOfDay(today),
  };
}

// --- Store reports ---

reportsRouter.get("/store/inward", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await prisma.stockInward.findMany({
    where: { inwardDate: { gte: from, lte: to } },
    include: { items: { include: { product: { include: { unit: true } } } }, supplier: true },
    orderBy: { inwardDate: "desc" },
  }));
}));

reportsRouter.get("/store/issue", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await prisma.stockIssue.findMany({
    where: { issueDate: { gte: from, lte: to } },
    include: { items: { include: { product: { include: { unit: true } } } } },
    orderBy: { issueDate: "desc" },
  }));
}));

reportsRouter.get("/store/product-wise-stock", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await getStoreStockSummary(from, to));
}));

reportsRouter.get("/store/purchase-value", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await purchaseValueReport(from, to));
}));

reportsRouter.get("/store/supplier-wise-purchase", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await supplierWisePurchaseReport(from, to));
}));

reportsRouter.get("/store/average-rate", asyncHandler(async (_req, res) => {
  res.json(await averageRateReport());
}));

reportsRouter.get("/store/low-stock", asyncHandler(async (_req, res) => {
  res.json(await lowStockReport());
}));

// --- Canteen reports ---

reportsRouter.get("/canteen/daily-sales", asyncHandler(async (req, res) => {
  const today = new Date();
  const { from, to } = req.query.from ? rangeFromQuery(req.query as Record<string, string | undefined>) : { from: startOfDay(today), to: endOfDay(today) };
  res.json(await getDailySalesSummary(from, to));
}));

reportsRouter.get("/canteen/monthly-sales", asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  res.json(await getDailySalesSummary(from, to));
}));

reportsRouter.get("/canteen/stock", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await getCanteenStockSummary(from, to));
}));

reportsRouter.get("/canteen/consumption", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await consumptionReport(from, to));
}));

reportsRouter.get("/canteen/wastage", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await wastageCostReport(from, to));
}));

reportsRouter.get("/canteen/payment-mode", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await paymentModeReport(from, to));
}));

// --- Management reports ---

reportsRouter.get("/management/purchase-vs-sales", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await purchaseVsSalesReport(from, to));
}));

reportsRouter.get("/management/stock-value", asyncHandler(async (_req, res) => {
  res.json(await stockValueReport());
}));

reportsRouter.get("/management/food-cost", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await foodCostReport(from, to));
}));

reportsRouter.get("/management/wastage-cost", asyncHandler(async (req, res) => {
  const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
  res.json(await wastageCostReport(from, to));
}));

reportsRouter.get("/management/monthly-performance", asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  res.json(await monthlyCanteenPerformance(year, month));
}));
