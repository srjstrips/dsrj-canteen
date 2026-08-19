import { pool, query, queryOne } from "../../db/pool";
import { D } from "../../utils/money";
import { CanteenLedgerTxnType } from "../../types/domain";

export async function purchaseValueReport(from: Date, to: Date) {
  return query(
    pool,
    `SELECT sii.product_id AS "productId", p.name AS "productName", u.symbol AS unit,
        SUM(sii.quantity) AS quantity, SUM(sii.total_value) AS value
     FROM stock_inward_items sii
     JOIN stock_inwards si ON si.id = sii.stock_inward_id
     JOIN products p ON p.id = sii.product_id
     JOIN units u ON u.id = p.unit_id
     WHERE si.inward_date >= $1 AND si.inward_date <= $2
     GROUP BY sii.product_id, p.name, u.symbol
     ORDER BY p.name ASC`,
    [from, to]
  );
}

export async function supplierWisePurchaseReport(from: Date, to: Date) {
  return query(
    pool,
    `SELECT si.supplier_id AS "supplierId", s.name AS "supplierName",
        COUNT(*) AS "invoiceCount", SUM(si.total_value) AS "totalValue"
     FROM stock_inwards si
     JOIN suppliers s ON s.id = si.supplier_id
     WHERE si.inward_date >= $1 AND si.inward_date <= $2
     GROUP BY si.supplier_id, s.name
     ORDER BY s.name ASC`,
    [from, to]
  );
}

export async function averageRateReport() {
  return query(
    pool,
    `SELECT b.product_id AS "productId", p.name AS "productName", c.name AS category, u.symbol AS unit,
        b.quantity, b.avg_rate AS "avgRate", b.stock_value AS "stockValue"
     FROM store_stock_balances b
     JOIN products p ON p.id = b.product_id
     JOIN categories c ON c.id = p.category_id
     JOIN units u ON u.id = p.unit_id
     ORDER BY p.name ASC`
  );
}

export async function lowStockReport() {
  const rows = await query<{
    productId: string;
    productName: string;
    category: string;
    unit: string;
    minStockLevel: string;
    reorderLevel: string;
    storeQty: string | null;
    canteenQty: string | null;
  }>(
    pool,
    `SELECT p.id AS "productId", p.name AS "productName", c.name AS category, u.symbol AS unit,
        p.min_stock_level AS "minStockLevel", p.reorder_level AS "reorderLevel",
        sb.quantity AS "storeQty", cb.quantity AS "canteenQty"
     FROM products p
     JOIN categories c ON c.id = p.category_id
     JOIN units u ON u.id = p.unit_id
     LEFT JOIN store_stock_balances sb ON sb.product_id = p.id
     LEFT JOIN canteen_stock_balances cb ON cb.product_id = p.id
     WHERE p.active = TRUE`
  );
  return rows.filter((r) => D(r.storeQty ?? 0).lte(D(r.minStockLevel)) || D(r.canteenQty ?? 0).lte(D(r.minStockLevel)));
}

export async function consumptionReport(from: Date, to: Date) {
  return query(
    pool,
    `SELECT cl.*,
        jsonb_build_object('name', p.name, 'unit', jsonb_build_object('symbol', u.symbol), 'category', jsonb_build_object('name', c.name)) AS product
     FROM canteen_stock_ledger cl
     JOIN products p ON p.id = cl.product_id
     JOIN units u ON u.id = p.unit_id
     JOIN categories c ON c.id = p.category_id
     WHERE cl.txn_type = $1 AND cl.txn_date >= $2 AND cl.txn_date <= $3
     ORDER BY cl.txn_date DESC`,
    [CanteenLedgerTxnType.CONSUMPTION, from, to]
  );
}

export async function paymentModeReport(from: Date, to: Date) {
  return query(
    pool,
    `SELECT payment_mode AS "paymentMode", SUM(grand_total) AS "totalAmount", COUNT(*) AS "billCount"
     FROM sales WHERE bill_date >= $1 AND bill_date <= $2 AND status = 'COMPLETED'
     GROUP BY payment_mode`,
    [from, to]
  );
}

export async function purchaseVsSalesReport(from: Date, to: Date) {
  const [purchases, sales] = await Promise.all([
    queryOne<{ total: string | null }>(pool, "SELECT SUM(total_value) AS total FROM stock_inwards WHERE inward_date >= $1 AND inward_date <= $2", [from, to]),
    queryOne<{ total: string | null }>(
      pool,
      "SELECT SUM(grand_total) AS total FROM sales WHERE bill_date >= $1 AND bill_date <= $2 AND status = 'COMPLETED'",
      [from, to]
    ),
  ]);
  return {
    totalPurchaseValue: purchases?.total ?? 0,
    totalSalesValue: sales?.total ?? 0,
  };
}

export async function stockValueReport() {
  const [store, canteen] = await Promise.all([
    queryOne<{ total: string | null }>(pool, "SELECT SUM(stock_value) AS total FROM store_stock_balances"),
    queryOne<{ total: string | null }>(pool, "SELECT SUM(stock_value) AS total FROM canteen_stock_balances"),
  ]);
  return {
    storeStockValue: store?.total ?? 0,
    canteenStockValue: canteen?.total ?? 0,
  };
}

/** Food cost = value consumed by Sales + Consumption, as % of sales revenue. */
export async function foodCostReport(from: Date, to: Date) {
  const [cogsRow, sales] = await Promise.all([
    queryOne<{ total: string | null }>(
      pool,
      `SELECT SUM(out_qty * rate) AS total FROM canteen_stock_ledger
       WHERE txn_type IN ('SALE', 'CONSUMPTION') AND txn_date >= $1 AND txn_date <= $2`,
      [from, to]
    ),
    queryOne<{ total: string | null }>(
      pool,
      "SELECT SUM(grand_total) AS total FROM sales WHERE bill_date >= $1 AND bill_date <= $2 AND status = 'COMPLETED'",
      [from, to]
    ),
  ]);

  const costOfGoods = D(cogsRow?.total ?? 0);
  const revenue = D(sales?.total ?? 0);
  const foodCostPct = revenue.isZero() ? D(0) : costOfGoods.mul(100).div(revenue);

  return { costOfGoods, revenue, foodCostPct };
}

export async function wastageCostReport(from: Date, to: Date) {
  return query(
    pool,
    `SELECT reason, SUM(quantity) AS quantity, SUM(wastage_value) AS value
     FROM wastage WHERE wastage_date >= $1 AND wastage_date <= $2
     GROUP BY reason`,
    [from, to]
  );
}

export async function monthlyCanteenPerformance(year: number, month: number) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  const [salesRow, wastageRow, foodCost] = await Promise.all([
    queryOne<{ total: string | null; count: string }>(
      pool,
      "SELECT SUM(grand_total) AS total, COUNT(*) AS count FROM sales WHERE bill_date >= $1 AND bill_date <= $2 AND status = 'COMPLETED'",
      [from, to]
    ),
    queryOne<{ total: string | null }>(pool, "SELECT SUM(wastage_value) AS total FROM wastage WHERE wastage_date >= $1 AND wastage_date <= $2", [from, to]),
    foodCostReport(from, to),
  ]);
  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    totalBills: Number(salesRow?.count ?? 0),
    totalSales: salesRow?.total ?? 0,
    totalWastageValue: wastageRow?.total ?? 0,
    foodCostPct: foodCost.foodCostPct,
  };
}
