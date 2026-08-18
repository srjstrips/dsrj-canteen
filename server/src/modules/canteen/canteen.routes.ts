import { Router } from "express";
import { z } from "zod";
import { CanteenLedgerTxnType, PaymentMode, Role, StockArea, WastageReason } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import {
  getCanteenLedger,
  getCanteenStockSummary,
  postStockAdjustment,
  recordConsumption,
  recordWastage,
} from "./canteen.service";
import { createSale, getDailySalesSummary } from "./billing.service";

export const canteenRouter = Router();
canteenRouter.use(requireAuth);

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function rangeFromQuery(query: Record<string, string | undefined>) {
  const today = new Date();
  return {
    from: query.from ? new Date(query.from) : startOfDay(today),
    to: query.to ? new Date(query.to) : endOfDay(today),
  };
}

// ---------------------------------------------------------------------------
// Received Stock (read-only — populated by Store's Stock Issue)
// ---------------------------------------------------------------------------

canteenRouter.get(
  "/received-stock",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const received = await prisma.canteenStockLedger.findMany({
      where: { txnType: CanteenLedgerTxnType.RECEIVED, txnDate: { gte: from, lte: to } },
      include: { product: { include: { unit: true, category: true } } },
      orderBy: { txnDate: "desc" },
    });
    res.json(received);
  })
);

// ---------------------------------------------------------------------------
// Canteen Stock summary + ledger
// ---------------------------------------------------------------------------

canteenRouter.get(
  "/stock",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    res.json(await getCanteenStockSummary(from, to));
  })
);

canteenRouter.get(
  "/ledger/:productId",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const txnType = req.query.txnType as CanteenLedgerTxnType | undefined;
    res.json(await getCanteenLedger(req.params.productId, from ? new Date(from) : undefined, to ? new Date(to) : undefined, txnType));
  })
);

// ---------------------------------------------------------------------------
// Consumption
// ---------------------------------------------------------------------------

const consumptionSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive("Quantity must be greater than 0"),
  notes: z.string().optional(),
  consumptionDate: z.coerce.date().optional(),
});

canteenRouter.post(
  "/consumption",
  requireRole(Role.CANTEEN),
  validateBody(consumptionSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof consumptionSchema>;
    const result = await recordConsumption({ ...body, createdById: req.user!.sub });
    res.status(201).json(result);
  })
);

// ---------------------------------------------------------------------------
// Wastage
// ---------------------------------------------------------------------------

const wastageSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive("Quantity must be greater than 0"),
  reason: z.nativeEnum(WastageReason),
  notes: z.string().optional(),
  wastageDate: z.coerce.date().optional(),
});

canteenRouter.post(
  "/wastage",
  requireRole(Role.CANTEEN),
  validateBody(wastageSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof wastageSchema>;
    const result = await recordWastage({ ...body, createdById: req.user!.sub });
    res.status(201).json(result);
  })
);

canteenRouter.get(
  "/wastage",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const rows = await prisma.wastage.findMany({
      where: { wastageDate: { gte: from, lte: to } },
      include: { product: { include: { unit: true, category: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { wastageDate: "desc" },
    });
    res.json(rows);
  })
);

// ---------------------------------------------------------------------------
// Stock Adjustments (ADMIN only — authorized corrections, Store or Canteen)
// ---------------------------------------------------------------------------

const adjustmentSchema = z.object({
  area: z.nativeEnum(StockArea),
  productId: z.string().uuid(),
  quantityDelta: z.number().refine((v) => v !== 0, "Adjustment quantity cannot be zero"),
  rate: z.number().nonnegative().optional(),
  reason: z.string().min(1),
});

canteenRouter.post(
  "/adjustments",
  requireRole(Role.ADMIN),
  validateBody(adjustmentSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof adjustmentSchema>;
    const result = await postStockAdjustment({ ...body, createdById: req.user!.sub });
    res.status(201).json(result);
  })
);

canteenRouter.get(
  "/adjustments",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const area = req.query.area as StockArea | undefined;
    const rows = await prisma.stockAdjustment.findMany({
      where: { area },
      include: { product: { include: { unit: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(rows);
  })
);

// ---------------------------------------------------------------------------
// Billing / POS
// ---------------------------------------------------------------------------

const saleItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive("Quantity must be greater than 0"),
  rate: z.number().nonnegative("Rate cannot be negative"),
  discount: z.number().nonnegative().optional(),
});

const saleSchema = z.object({
  items: z.array(saleItemSchema).min(1),
  paymentMode: z.nativeEnum(PaymentMode),
  customerRef: z.string().optional(),
  billDate: z.coerce.date().optional(),
  clientRef: z.string().optional(),
});

canteenRouter.post(
  "/sales",
  requireRole(Role.CANTEEN),
  validateBody(saleSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof saleSchema>;
    const sale = await createSale({ ...body, createdById: req.user!.sub });
    res.status(201).json(sale);
  })
);

canteenRouter.get(
  "/sales",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const sales = await prisma.sale.findMany({
      where: { billDate: { gte: from, lte: to } },
      include: { items: { include: { product: true } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { billTime: "desc" },
    });
    res.json(sales);
  })
);

canteenRouter.get(
  "/sales/daily-summary",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    res.json(await getDailySalesSummary(from, to));
  })
);

// ---------------------------------------------------------------------------
// Canteen Dashboard
// ---------------------------------------------------------------------------

canteenRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const today = new Date();
    const from = startOfDay(today);
    const to = endOfDay(today);

    const [dailySales, balances, wastageAgg, consumptionAgg, products, topSelling] = await Promise.all([
      getDailySalesSummary(from, to),
      prisma.canteenStockBalance.aggregate({ _sum: { stockValue: true } }),
      prisma.wastage.aggregate({ where: { wastageDate: { gte: from, lte: to } }, _sum: { wastageValue: true } }),
      prisma.canteenStockLedger.aggregate({
        where: { txnType: CanteenLedgerTxnType.CONSUMPTION, txnDate: { gte: from, lte: to } },
        _sum: { outQty: true },
      }),
      prisma.product.findMany({ where: { active: true }, include: { canteenStockBalance: true } }),
      prisma.saleItem.groupBy({
        by: ["productId"],
        where: { sale: { billDate: { gte: from, lte: to } } },
        _sum: { quantity: true, amount: true },
        orderBy: { _sum: { amount: "desc" } },
        take: 5,
      }),
    ]);

    const lowStockCount = products.filter((p) => (p.canteenStockBalance?.quantity.toNumber() ?? 0) <= p.minStockLevel.toNumber()).length;

    const topProducts = await Promise.all(
      topSelling.map(async (row) => {
        const product = await prisma.product.findUnique({ where: { id: row.productId } });
        return { productId: row.productId, name: product?.name ?? "Unknown", quantity: row._sum.quantity, amount: row._sum.amount };
      })
    );

    res.json({
      todaysSales: dailySales.totalSales,
      totalBills: dailySales.totalBills,
      canteenStockValue: balances._sum.stockValue ?? 0,
      todaysWastageValue: wastageAgg._sum.wastageValue ?? 0,
      todaysConsumptionQty: consumptionAgg._sum.outQty ?? 0,
      lowStockCount,
      topSellingProducts: topProducts,
    });
  })
);
