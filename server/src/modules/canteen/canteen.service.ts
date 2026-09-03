import { pool, query, queryOne, withTransaction } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { D, applyInward, applyIssue, Decimal } from "../../utils/money";
import { writeAudit } from "../../utils/audit";
import { CanteenLedgerTxnType, StockArea, WastageReason } from "../../types/domain";

export interface WastageInput {
  productId: string;
  quantity: number;
  reason: WastageReason;
  notes?: string;
  wastageDate?: Date;
  createdById: string;
}

const WASTAGE_SELECT = `
  SELECT w.*,
    jsonb_build_object('name', p.name, 'unit', jsonb_build_object('symbol', u.symbol), 'category', jsonb_build_object('name', c.name)) AS product,
    jsonb_build_object('name', cb.name) AS "createdBy"
  FROM wastage w
  JOIN products p ON p.id = w.product_id
  JOIN units u ON u.id = p.unit_id
  JOIN categories c ON c.id = p.category_id
  JOIN users cb ON cb.id = w.created_by_id
`;

/** Records Wastage and posts a matching WASTAGE ledger entry. Rate/value are
 * always computed from the current canteen average rate, never typed in. */
export async function recordWastage(input: WastageInput) {
  if (input.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");

  return withTransaction(async (client) => {
    await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [input.productId]);

    const balance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
      client,
      "SELECT quantity, stock_value, avg_rate FROM canteen_stock_balances WHERE product_id = $1",
      [input.productId]
    );
    const openingQty = balance?.quantity ?? D(0);
    if (D(input.quantity).gt(openingQty)) {
      throw ApiError.badRequest(`Insufficient stock. Available quantity: ${D(openingQty).toString()}.`);
    }
    const openingValue = balance?.stockValue ?? D(0);
    const rate = balance?.avgRate ?? D(0);

    const { newQty, newValue, issueValue } = applyIssue(openingQty, openingValue, rate, input.quantity);

    await query(client, "UPDATE canteen_stock_balances SET quantity = $2, stock_value = $3, updated_at = now() WHERE product_id = $1", [
      input.productId,
      newQty.toString(),
      newValue.toString(),
    ]);

    const wastageDate = input.wastageDate ?? new Date();
    const wastage = await queryOne<{ id: string }>(
      client,
      `INSERT INTO wastage (wastage_date, product_id, quantity, rate, wastage_value, reason, notes, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [wastageDate, input.productId, input.quantity, rate.toString(), issueValue.toString(), input.reason, input.notes ?? null, input.createdById]
    );

    await query(
      client,
      `INSERT INTO canteen_stock_ledger (product_id, txn_date, txn_type, ref_id, in_qty, out_qty, rate, balance_qty, balance_value, remarks)
       VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
      [
        input.productId,
        wastageDate,
        CanteenLedgerTxnType.WASTAGE,
        wastage!.id,
        input.quantity,
        rate.toString(),
        newQty.toString(),
        newValue.toString(),
        `Wastage: ${input.reason}${input.notes ? ` — ${input.notes}` : ""}`,
      ]
    );

    const result = await queryOne(client, `${WASTAGE_SELECT} WHERE w.id = $1`, [wastage!.id]);
    await writeAudit(client, { entity: "Wastage", entityId: wastage!.id, action: "CREATE", actorId: input.createdById, after: result });

    return result;
  });
}

export interface ConsumptionInput {
  productId: string;
  quantity: number;
  notes?: string;
  consumptionDate?: Date;
  createdById: string;
}

/** Internal-use consumption (food preparation draw-down). Posts a
 * CONSUMPTION ledger entry; there is no separate header table for this
 * per spec §23 — the ledger row itself is the record. */
export async function recordConsumption(input: ConsumptionInput) {
  if (input.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");

  return withTransaction(async (client) => {
    await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [input.productId]);

    const balance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
      client,
      "SELECT quantity, stock_value, avg_rate FROM canteen_stock_balances WHERE product_id = $1",
      [input.productId]
    );
    const openingQty = balance?.quantity ?? D(0);
    if (D(input.quantity).gt(openingQty)) {
      throw ApiError.badRequest(`Insufficient stock. Available quantity: ${D(openingQty).toString()}.`);
    }
    const openingValue = balance?.stockValue ?? D(0);
    const rate = balance?.avgRate ?? D(0);

    const { newQty, newValue } = applyIssue(openingQty, openingValue, rate, input.quantity);

    await query(client, "UPDATE canteen_stock_balances SET quantity = $2, stock_value = $3, updated_at = now() WHERE product_id = $1", [
      input.productId,
      newQty.toString(),
      newValue.toString(),
    ]);

    const consumptionDate = input.consumptionDate ?? new Date();
    const ledgerEntry = await queryOne<{ id: string }>(
      client,
      `INSERT INTO canteen_stock_ledger (product_id, txn_date, txn_type, in_qty, out_qty, rate, balance_qty, balance_value, remarks)
       VALUES ($1, $2, $3, 0, $4, $5, $6, $7, $8) RETURNING id`,
      [
        input.productId,
        consumptionDate,
        CanteenLedgerTxnType.CONSUMPTION,
        input.quantity,
        rate.toString(),
        newQty.toString(),
        newValue.toString(),
        input.notes ? `Consumption — ${input.notes}` : "Consumption",
      ]
    );

    await writeAudit(client, { entity: "CanteenConsumption", entityId: ledgerEntry!.id, action: "CREATE", actorId: input.createdById, after: ledgerEntry });

    return ledgerEntry;
  });
}

export interface AdjustmentInput {
  area: StockArea;
  productId: string;
  quantityDelta: number; // signed: positive = correction upward, negative = downward
  rate?: number; // optional override; defaults to current average rate
  reason: string;
  createdById: string;
}

const ADJUSTMENT_SELECT = `
  SELECT sa.*,
    jsonb_build_object('name', p.name, 'unit', jsonb_build_object('symbol', u.symbol)) AS product,
    jsonb_build_object('name', cb.name) AS "createdBy"
  FROM stock_adjustments sa
  JOIN products p ON p.id = sa.product_id
  JOIN units u ON u.id = p.unit_id
  JOIN users cb ON cb.id = sa.created_by_id
`;

/** ADMIN-authorized stock correction for either Store or Canteen. Never
 * edits history — always adds a new ledger row (spec §22). */
export async function postStockAdjustment(input: AdjustmentInput) {
  if (input.quantityDelta === 0) throw ApiError.badRequest("Adjustment quantity cannot be zero");
  if (!input.reason?.trim()) throw ApiError.badRequest("Adjustment reason is required");

  return withTransaction(async (client) => {
    await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [input.productId]);
    const isStore = input.area === StockArea.STORE;
    const balanceTable = isStore ? "store_stock_balances" : "canteen_stock_balances";

    const balance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
      client,
      `SELECT quantity, stock_value, avg_rate FROM ${balanceTable} WHERE product_id = $1`,
      [input.productId]
    );
    const openingQty = balance?.quantity ?? D(0);
    const openingValue = balance?.stockValue ?? D(0);
    const currentRate = balance?.avgRate ?? D(0);
    const rate = input.rate !== undefined ? D(input.rate) : currentRate;

    let newQty: Decimal, newValue: Decimal, newAvgRate: Decimal, valueDelta: Decimal;
    if (input.quantityDelta > 0) {
      const r = applyInward(openingQty, openingValue, input.quantityDelta, rate);
      newQty = r.newQty;
      newValue = r.newValue;
      newAvgRate = r.newAvgRate;
      valueDelta = r.inwardValue;
    } else {
      const qtyOut = Math.abs(input.quantityDelta);
      if (D(qtyOut).gt(openingQty)) {
        throw ApiError.badRequest(`Insufficient stock. Available quantity: ${D(openingQty).toString()}.`);
      }
      const r = applyIssue(openingQty, openingValue, currentRate, qtyOut);
      newQty = r.newQty;
      newValue = r.newValue;
      newAvgRate = r.avgRate;
      valueDelta = r.issueValue.neg();
    }

    await query(
      client,
      `INSERT INTO ${balanceTable} (product_id, quantity, avg_rate, stock_value, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (product_id) DO UPDATE SET quantity = $2, avg_rate = $3, stock_value = $4, updated_at = now()`,
      [input.productId, newQty.toString(), newAvgRate.toString(), newValue.toString()]
    );

    const adjustment = await queryOne<{ id: string }>(
      client,
      `INSERT INTO stock_adjustments (area, product_id, quantity_delta, rate, value_delta, reason, created_by_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.area, input.productId, input.quantityDelta, newAvgRate.toString(), valueDelta.toString(), input.reason, input.createdById]
    );

    const ledgerTable = isStore ? "store_stock_ledger" : "canteen_stock_ledger";
    const inCol = isStore ? "inward_qty" : "in_qty";
    const outCol = isStore ? "issue_qty" : "out_qty";
    await query(
      client,
      `INSERT INTO ${ledgerTable} (product_id, txn_type, ref_id, ${inCol}, ${outCol}, rate, balance_qty, balance_value, remarks)
       VALUES ($1, 'ADJUSTMENT', $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.productId,
        adjustment!.id,
        input.quantityDelta > 0 ? input.quantityDelta : 0,
        input.quantityDelta < 0 ? Math.abs(input.quantityDelta) : 0,
        newAvgRate.toString(),
        newQty.toString(),
        newValue.toString(),
        `Adjustment: ${input.reason}`,
      ]
    );

    const result = await queryOne(client, `${ADJUSTMENT_SELECT} WHERE sa.id = $1`, [adjustment!.id]);
    await writeAudit(client, { entity: "StockAdjustment", entityId: adjustment!.id, action: "CREATE", actorId: input.createdById, after: result });

    return result;
  });
}

export interface CanteenStockRow {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  openingQty: Decimal;
  received: Decimal;
  consumption: Decimal;
  sales: Decimal;
  wastage: Decimal;
  adjustment: Decimal;
  balanceQty: Decimal;
  avgRate: Decimal;
  stockValue: Decimal;
  isLowStock: boolean;
}

/** Canteen Stock screen (spec §14): Received − Consumption − Sales − Wastage ± Adjustments. */
export async function getCanteenStockSummary(from: Date, to: Date): Promise<CanteenStockRow[]> {
  const products = await query<{
    id: string;
    name: string;
    categoryName: string;
    unitSymbol: string;
    minStockLevel: string;
    quantity: string | null;
    avgRate: string | null;
    stockValue: string | null;
  }>(
    pool,
    `SELECT p.id, p.name, c.name AS "categoryName", u.symbol AS "unitSymbol", p.min_stock_level AS "minStockLevel",
        b.quantity, b.avg_rate AS "avgRate", b.stock_value AS "stockValue"
     FROM products p
     JOIN categories c ON c.id = p.category_id
     JOIN units u ON u.id = p.unit_id
     LEFT JOIN canteen_stock_balances b ON b.product_id = p.id
     WHERE p.active = TRUE AND c.is_food = FALSE
     ORDER BY p.name ASC`
  );

  const rows: CanteenStockRow[] = [];
  for (const product of products) {
    const prior = await queryOne<{ balanceQty: string }>(
      pool,
      `SELECT balance_qty AS "balanceQty" FROM canteen_stock_ledger WHERE product_id = $1 AND txn_date < $2 ORDER BY txn_date DESC LIMIT 1`,
      [product.id, from]
    );
    const openingQty = D(prior?.balanceQty ?? 0);

    const grouped = await query<{ txnType: string; inSum: string | null; outSum: string | null }>(
      pool,
      `SELECT txn_type AS "txnType", SUM(in_qty) AS "inSum", SUM(out_qty) AS "outSum"
       FROM canteen_stock_ledger WHERE product_id = $1 AND txn_date >= $2 AND txn_date <= $3
       GROUP BY txn_type`,
      [product.id, from, to]
    );

    const sums = new Map<string, { in: Decimal; out: Decimal }>();
    for (const g of grouped) sums.set(g.txnType, { in: D(g.inSum ?? 0), out: D(g.outSum ?? 0) });

    const received = sums.get("RECEIVED")?.in ?? D(0);
    const sales = sums.get("SALE")?.out ?? D(0);
    const consumption = sums.get("CONSUMPTION")?.out ?? D(0);
    const wastage = sums.get("WASTAGE")?.out ?? D(0);
    const adjIn = sums.get("ADJUSTMENT")?.in ?? D(0);
    const adjOut = sums.get("ADJUSTMENT")?.out ?? D(0);

    const balanceQty = openingQty.add(received).add(adjIn).sub(sales).sub(consumption).sub(wastage).sub(adjOut);

    rows.push({
      productId: product.id,
      productName: product.name,
      category: product.categoryName,
      unit: product.unitSymbol,
      openingQty,
      received,
      consumption,
      sales,
      wastage,
      adjustment: adjIn.sub(adjOut),
      balanceQty,
      avgRate: D(product.avgRate ?? 0),
      stockValue: D(product.stockValue ?? 0),
      isLowStock: D(product.quantity ?? 0).lte(D(product.minStockLevel)),
    });
  }
  return rows;
}

export async function getCanteenLedger(productId: string, from?: Date, to?: Date, txnType?: CanteenLedgerTxnType) {
  const params: unknown[] = [productId];
  let where = "product_id = $1";
  if (txnType) {
    params.push(txnType);
    where += ` AND txn_type = $${params.length}`;
  }
  if (from) {
    params.push(from);
    where += ` AND txn_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    where += ` AND txn_date <= $${params.length}`;
  }
  return query(
    pool,
    `SELECT id, product_id AS "productId", txn_date AS "txnDate", txn_type AS "txnType", ref_id AS "refId",
        in_qty AS "inQty", out_qty AS "outQty", rate, balance_qty AS "balanceQty", balance_value AS "balanceValue", remarks
     FROM canteen_stock_ledger WHERE ${where} ORDER BY txn_date ASC`,
    params
  );
}
