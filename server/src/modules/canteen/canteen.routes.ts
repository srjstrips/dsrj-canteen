import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { CanteenLedgerTxnType, PaymentMode, Role, StockArea, WastageReason } from "../../types/domain";
import { sendNotification } from "../../utils/fcm";
import {
  getCanteenLedger,
  getCanteenStockSummary,
  postStockAdjustment,
  recordConsumption,
  recordWastage,
} from "./canteen.service";
import { SALE_SELECT, createSale, getDailySalesSummary } from "./billing.service";

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
    const received = await query(
      pool,
      `SELECT cl.*,
          jsonb_build_object('name', p.name, 'unit', jsonb_build_object('symbol', u.symbol), 'category', jsonb_build_object('name', c.name)) AS product
       FROM canteen_stock_ledger cl
       JOIN products p ON p.id = cl.product_id
       JOIN units u ON u.id = p.unit_id
       JOIN categories c ON c.id = p.category_id
       WHERE cl.txn_type = $1 AND cl.txn_date >= $2 AND cl.txn_date <= $3
       ORDER BY cl.txn_date DESC`,
      [CanteenLedgerTxnType.RECEIVED, from, to]
    );
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
    const rows = await query(
      pool,
      `SELECT w.*,
          jsonb_build_object('name', p.name, 'unit', jsonb_build_object('symbol', u.symbol), 'category', jsonb_build_object('name', c.name)) AS product,
          jsonb_build_object('name', cb.name) AS "createdBy"
       FROM wastage w
       JOIN products p ON p.id = w.product_id
       JOIN units u ON u.id = p.unit_id
       JOIN categories c ON c.id = p.category_id
       JOIN users cb ON cb.id = w.created_by_id
       WHERE w.wastage_date >= $1 AND w.wastage_date <= $2
       ORDER BY w.wastage_date DESC`,
      [from, to]
    );
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
    const rows = await query(
      pool,
      `SELECT sa.*,
          jsonb_build_object('name', p.name, 'unit', jsonb_build_object('symbol', u.symbol)) AS product,
          jsonb_build_object('name', cb.name) AS "createdBy"
       FROM stock_adjustments sa
       JOIN products p ON p.id = sa.product_id
       JOIN units u ON u.id = p.unit_id
       JOIN users cb ON cb.id = sa.created_by_id
       ${area ? "WHERE sa.area = $1" : ""}
       ORDER BY sa.created_at DESC`,
      area ? [area] : []
    );
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
    sendNotification({
      type: "POS_SALE",
      title: "New POS Sale",
      body: `Bill recorded at POS`,
      targetRoles: ["CANTEEN"],
    }).catch(() => {});
    res.status(201).json(sale);
  })
);

canteenRouter.get(
  "/sales",
  asyncHandler(async (req, res) => {
    const { from, to } = rangeFromQuery(req.query as Record<string, string | undefined>);
    const sales = await query(pool, `${SALE_SELECT} WHERE s.bill_date >= $1 AND s.bill_date <= $2 ORDER BY s.bill_time DESC`, [from, to]);
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

    const [dailySales, stockValueRow, wastageRow, consumptionRow, lowStockRow, topSelling] = await Promise.all([
      getDailySalesSummary(from, to),
      queryOne<{ total: string | null }>(pool, "SELECT SUM(stock_value) AS total FROM canteen_stock_balances"),
      queryOne<{ total: string | null }>(pool, "SELECT SUM(wastage_value) AS total FROM wastage WHERE wastage_date >= $1 AND wastage_date <= $2", [from, to]),
      queryOne<{ total: string | null }>(
        pool,
        "SELECT SUM(out_qty) AS total FROM canteen_stock_ledger WHERE txn_type = 'CONSUMPTION' AND txn_date >= $1 AND txn_date <= $2",
        [from, to]
      ),
      queryOne<{ count: string }>(
        pool,
        `SELECT COUNT(*) AS count FROM products p LEFT JOIN canteen_stock_balances b ON b.product_id = p.id
         WHERE p.active = TRUE AND COALESCE(b.quantity, 0) <= p.min_stock_level`
      ),
      query<{ productId: string; name: string; quantity: string; amount: string }>(
        pool,
        `SELECT si.product_id AS "productId", p.name, SUM(si.quantity) AS quantity, SUM(si.amount) AS amount
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
         JOIN products p ON p.id = si.product_id
         WHERE s.bill_date >= $1 AND s.bill_date <= $2
         GROUP BY si.product_id, p.name
         ORDER BY SUM(si.amount) DESC
         LIMIT 5`,
        [from, to]
      ),
    ]);

    res.json({
      todaysSales: dailySales.totalSales,
      totalBills: dailySales.totalBills,
      canteenStockValue: stockValueRow?.total ?? 0,
      todaysWastageValue: wastageRow?.total ?? 0,
      todaysConsumptionQty: consumptionRow?.total ?? 0,
      lowStockCount: Number(lowStockRow?.count ?? 0),
      topSellingProducts: topSelling,
    });
  })
);
