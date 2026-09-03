import { pool, query, queryOne, withTransaction } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { applyInward, applyIssue, D, Decimal } from "../../utils/money";
import { generateDocNo } from "../../utils/docNumber";
import { writeAudit } from "../../utils/audit";
import { StoreLedgerTxnType, CanteenLedgerTxnType } from "../../types/domain";

export interface InwardItemInput {
  productId: string;
  quantity: number;
  rate: number;
}

export interface RecordInwardInput {
  supplierId: string;
  invoiceNumber?: string;
  inwardDate?: Date;
  items: InwardItemInput[];
  createdById: string;
}

export const INWARD_SELECT = `
  SELECT si.*,
    jsonb_build_object('id', s.id, 'name', s.name) AS supplier,
    jsonb_build_object('id', u.id, 'name', u.name) AS "createdBy",
    COALESCE(items.items, '[]'::jsonb) AS items
  FROM stock_inwards si
  JOIN suppliers s ON s.id = si.supplier_id
  JOIN users u ON u.id = si.created_by_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', sii.id, 'quantity', sii.quantity, 'rate', sii.rate, 'totalValue', sii.total_value,
      'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', jsonb_build_object('id', pu.id, 'name', pu.name, 'symbol', pu.symbol))
    ) ORDER BY sii.created_at) AS items
    FROM stock_inward_items sii
    JOIN products p ON p.id = sii.product_id
    JOIN units pu ON pu.id = p.unit_id
    WHERE sii.stock_inward_id = si.id
  ) items ON TRUE
`;

/**
 * Records a Stock Inward and posts the moving weighted-average costing
 * update + ledger entry for every line item, all in one DB transaction.
 * See docs/ARCHITECTURE.md §3.1.
 */
export async function recordStockInward(input: RecordInwardInput) {
  if (input.items.length === 0) throw ApiError.badRequest("At least one line item is required");

  return withTransaction(async (client) => {
    const inwardDate = input.inwardDate ?? new Date();
    const inwardNo = generateDocNo("INW", inwardDate);

    const inward = await queryOne<{ id: string }>(
      client,
      `INSERT INTO stock_inwards (inward_no, inward_date, supplier_id, invoice_number, created_by_id, total_value)
       VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
      [inwardNo, inwardDate, input.supplierId, input.invoiceNumber ?? null, input.createdById]
    );
    const inwardId = inward!.id;

    let totalValue = D(0);

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Product quantity must be greater than 0");
      if (item.rate < 0) throw ApiError.badRequest("Product rate cannot be negative");

      // Serialize concurrent stock movements for this product.
      const product = await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.productId]);
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      const balance = await queryOne<{ quantity: string; stockValue: string }>(
        client,
        "SELECT quantity, stock_value FROM store_stock_balances WHERE product_id = $1",
        [item.productId]
      );
      const openingQty = balance?.quantity ?? D(0);
      const openingValue = balance?.stockValue ?? D(0);

      const { newQty, newValue, newAvgRate, inwardValue } = applyInward(openingQty, openingValue, item.quantity, item.rate);

      await query(
        client,
        `INSERT INTO store_stock_balances (product_id, quantity, avg_rate, stock_value, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (product_id) DO UPDATE SET quantity = $2, avg_rate = $3, stock_value = $4, updated_at = now()`,
        [item.productId, newQty.toString(), newAvgRate.toString(), newValue.toString()]
      );

      await query(
        client,
        `INSERT INTO stock_inward_items (stock_inward_id, product_id, quantity, rate, total_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [inwardId, item.productId, item.quantity, item.rate, inwardValue.toString()]
      );

      await query(
        client,
        `INSERT INTO store_stock_ledger (product_id, txn_date, txn_type, ref_id, inward_qty, issue_qty, rate, balance_qty, balance_value, remarks)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
        [
          item.productId,
          inwardDate,
          StoreLedgerTxnType.INWARD,
          inwardId,
          item.quantity,
          newAvgRate.toString(),
          newQty.toString(),
          newValue.toString(),
          `Inward ${inwardNo} (rate ₹${D(item.rate).toFixed(2)})`,
        ]
      );

      totalValue = totalValue.add(inwardValue);
    }

    await query(client, "UPDATE stock_inwards SET total_value = $2 WHERE id = $1", [inwardId, totalValue.toString()]);

    const updated = await queryOne(client, `${INWARD_SELECT} WHERE si.id = $1`, [inwardId]);

    await writeAudit(client, { entity: "StockInward", entityId: inwardId, action: "CREATE", actorId: input.createdById, after: updated });

    return updated;
  });
}

export interface IssueItemInput {
  productId: string;
  quantity: number;
}

export interface IssueStockInput {
  items: IssueItemInput[];
  issueDate?: Date;
  createdById: string;
}

export const ISSUE_SELECT = `
  SELECT si.*,
    jsonb_build_object('id', u.id, 'name', u.name) AS "createdBy",
    COALESCE(items.items, '[]'::jsonb) AS items
  FROM stock_issues si
  JOIN users u ON u.id = si.created_by_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', sii.id, 'quantity', sii.quantity, 'issueRate', sii.issue_rate, 'issueValue', sii.issue_value,
      'previousBalance', sii.previous_balance, 'balanceAfterIssue', sii.balance_after_issue,
      'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', jsonb_build_object('id', pu.id, 'name', pu.name, 'symbol', pu.symbol))
    ) ORDER BY sii.created_at) AS items
    FROM stock_issue_items sii
    JOIN products p ON p.id = sii.product_id
    JOIN units pu ON pu.id = p.unit_id
    WHERE sii.stock_issue_id = si.id
  ) items ON TRUE
`;

/**
 * Issues stock from Store to Canteen. Validates against available balance,
 * values the issue at the current (unchanged-by-issue) average rate, and —
 * in the same transaction — credits Canteen's own weighted-average balance
 * so the two sides can never disagree. See docs/ARCHITECTURE.md §3.1/§3.2.
 */
export async function issueStockToCanteen(input: IssueStockInput) {
  if (input.items.length === 0) throw ApiError.badRequest("At least one line item is required");

  return withTransaction(async (client) => {
    const issueDate = input.issueDate ?? new Date();
    const issueNo = generateDocNo("ISS", issueDate);

    const issue = await queryOne<{ id: string }>(
      client,
      `INSERT INTO stock_issues (issue_no, issue_date, created_by_id, total_value) VALUES ($1, $2, $3, 0) RETURNING id`,
      [issueNo, issueDate, input.createdById]
    );
    const issueId = issue!.id;

    let totalValue = D(0);

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Issue quantity must be greater than 0");

      const product = await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.productId]);
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      const balance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
        client,
        "SELECT quantity, stock_value, avg_rate FROM store_stock_balances WHERE product_id = $1",
        [item.productId]
      );
      const openingQty = balance?.quantity ?? D(0);

      if (D(item.quantity).gt(openingQty)) {
        throw ApiError.badRequest(`Insufficient stock. Available quantity: ${D(openingQty).toString()}.`);
      }

      const openingValue = balance?.stockValue ?? D(0);
      const currentAvgRate = balance?.avgRate ?? D(0);

      const { newQty, newValue, avgRate, issueValue } = applyIssue(openingQty, openingValue, currentAvgRate, item.quantity);

      await query(client, "UPDATE store_stock_balances SET quantity = $2, stock_value = $3, updated_at = now() WHERE product_id = $1", [
        item.productId,
        newQty.toString(),
        newValue.toString(),
      ]);

      const issueItem = await queryOne<{ id: string }>(
        client,
        `INSERT INTO stock_issue_items (stock_issue_id, product_id, quantity, issue_rate, issue_value, previous_balance, balance_after_issue)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [issueId, item.productId, item.quantity, avgRate.toString(), issueValue.toString(), openingQty.toString(), newQty.toString()]
      );

      await query(
        client,
        `INSERT INTO store_stock_ledger (product_id, txn_date, txn_type, ref_id, inward_qty, issue_qty, rate, balance_qty, balance_value, remarks)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
        [item.productId, issueDate, StoreLedgerTxnType.ISSUE, issueId, item.quantity, avgRate.toString(), newQty.toString(), newValue.toString(), `Issued to Canteen ${issueNo}`]
      );

      totalValue = totalValue.add(issueValue);

      // --- Canteen side: receive the issued stock at the store issue rate ---
      const canteenBalance = await queryOne<{ quantity: string; stockValue: string }>(
        client,
        "SELECT quantity, stock_value FROM canteen_stock_balances WHERE product_id = $1",
        [item.productId]
      );
      const cOpeningQty = canteenBalance?.quantity ?? D(0);
      const cOpeningValue = canteenBalance?.stockValue ?? D(0);

      const received = applyInward(cOpeningQty, cOpeningValue, item.quantity, avgRate);

      await query(
        client,
        `INSERT INTO canteen_stock_balances (product_id, quantity, avg_rate, stock_value, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (product_id) DO UPDATE SET quantity = $2, avg_rate = $3, stock_value = $4, updated_at = now()`,
        [item.productId, received.newQty.toString(), received.newAvgRate.toString(), received.newValue.toString()]
      );

      await query(
        client,
        `INSERT INTO canteen_stock_ledger (product_id, txn_date, txn_type, ref_id, in_qty, out_qty, rate, balance_qty, balance_value, remarks)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
        [
          item.productId,
          issueDate,
          CanteenLedgerTxnType.RECEIVED,
          issueItem!.id,
          item.quantity,
          received.newAvgRate.toString(),
          received.newQty.toString(),
          received.newValue.toString(),
          `Received from Store ${issueNo}`,
        ]
      );
    }

    await query(client, "UPDATE stock_issues SET total_value = $2 WHERE id = $1", [issueId, totalValue.toString()]);

    const updated = await queryOne(client, `${ISSUE_SELECT} WHERE si.id = $1`, [issueId]);

    await writeAudit(client, { entity: "StockIssue", entityId: issueId, action: "CREATE", actorId: input.createdById, after: updated });

    return updated;
  });
}

export interface ReturnItemInput {
  productId: string;
  quantity: number;
}

export interface ReturnStockInput {
  items: ReturnItemInput[];
  returnDate?: Date;
  notes?: string;
  createdById: string;
}

export const RETURN_SELECT = `
  SELECT sr.*,
    jsonb_build_object('id', u.id, 'name', u.name) AS "createdBy",
    COALESCE(items.items, '[]'::jsonb) AS items
  FROM stock_returns sr
  JOIN users u ON u.id = sr.created_by_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', sri.id, 'quantity', sri.quantity, 'returnRate', sri.return_rate, 'returnValue', sri.return_value,
      'canteenBalanceAfter', sri.canteen_balance_after, 'storeBalanceAfter', sri.store_balance_after,
      'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', jsonb_build_object('id', pu.id, 'name', pu.name, 'symbol', pu.symbol))
    ) ORDER BY sri.created_at) AS items
    FROM stock_return_items sri
    JOIN products p ON p.id = sri.product_id
    JOIN units pu ON pu.id = p.unit_id
    WHERE sri.stock_return_id = sr.id
  ) items ON TRUE
`;

/**
 * Returns unused stock from Canteen back to Store — the reverse of a Stock
 * Issue. Canteen stock decreases (valued at the canteen's average rate) and,
 * in the same transaction, Store stock increases at that same rate via its
 * weighted-average, so the two sides never disagree. Capped at what the
 * canteen currently holds — you can't return stock that isn't there.
 */
export async function recordReturnFromCanteen(input: ReturnStockInput) {
  if (input.items.length === 0) throw ApiError.badRequest("At least one line item is required");

  return withTransaction(async (client) => {
    const returnDate = input.returnDate ?? new Date();
    const returnNo = generateDocNo("RET", returnDate);

    const ret = await queryOne<{ id: string }>(
      client,
      `INSERT INTO stock_returns (return_no, return_date, notes, created_by_id, total_value) VALUES ($1, $2, $3, $4, 0) RETURNING id`,
      [returnNo, returnDate, input.notes ?? null, input.createdById]
    );
    const returnId = ret!.id;

    let totalValue = D(0);

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Return quantity must be greater than 0");

      const product = await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.productId]);
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      // --- Canteen side: issue (out) the returned quantity at canteen avg rate ---
      const cBalance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
        client,
        "SELECT quantity, stock_value, avg_rate FROM canteen_stock_balances WHERE product_id = $1",
        [item.productId]
      );
      const cOpeningQty = cBalance?.quantity ?? D(0);
      if (D(item.quantity).gt(cOpeningQty)) {
        throw ApiError.badRequest(`Cannot return more than the canteen holds. Canteen quantity: ${D(cOpeningQty).toString()}.`);
      }
      const cOpeningValue = cBalance?.stockValue ?? D(0);
      const returnRate = cBalance?.avgRate ?? D(0);

      const canteenOut = applyIssue(cOpeningQty, cOpeningValue, returnRate, item.quantity);
      const returnValue = canteenOut.issueValue;

      await query(client, "UPDATE canteen_stock_balances SET quantity = $2, stock_value = $3, updated_at = now() WHERE product_id = $1", [
        item.productId,
        canteenOut.newQty.toString(),
        canteenOut.newValue.toString(),
      ]);

      // --- Store side: receive (inward) the returned quantity at that rate ---
      const sBalance = await queryOne<{ quantity: string; stockValue: string }>(
        client,
        "SELECT quantity, stock_value FROM store_stock_balances WHERE product_id = $1",
        [item.productId]
      );
      const sOpeningQty = sBalance?.quantity ?? D(0);
      const sOpeningValue = sBalance?.stockValue ?? D(0);
      const storeIn = applyInward(sOpeningQty, sOpeningValue, item.quantity, returnRate);

      await query(
        client,
        `INSERT INTO store_stock_balances (product_id, quantity, avg_rate, stock_value, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (product_id) DO UPDATE SET quantity = $2, avg_rate = $3, stock_value = $4, updated_at = now()`,
        [item.productId, storeIn.newQty.toString(), storeIn.newAvgRate.toString(), storeIn.newValue.toString()]
      );

      const returnItem = await queryOne<{ id: string }>(
        client,
        `INSERT INTO stock_return_items (stock_return_id, product_id, quantity, return_rate, return_value, canteen_balance_after, store_balance_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [returnId, item.productId, item.quantity, returnRate.toString(), returnValue.toString(), canteenOut.newQty.toString(), storeIn.newQty.toString()]
      );

      // Ledgers: canteen RETURN (out), store RETURN (in).
      await query(
        client,
        `INSERT INTO canteen_stock_ledger (product_id, txn_date, txn_type, ref_id, in_qty, out_qty, rate, balance_qty, balance_value, remarks)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
        [
          item.productId,
          returnDate,
          CanteenLedgerTxnType.RETURN,
          returnItem!.id,
          item.quantity,
          returnRate.toString(),
          canteenOut.newQty.toString(),
          canteenOut.newValue.toString(),
          `Returned to Store ${returnNo}`,
        ]
      );
      await query(
        client,
        `INSERT INTO store_stock_ledger (product_id, txn_date, txn_type, ref_id, inward_qty, issue_qty, rate, balance_qty, balance_value, remarks)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9)`,
        [
          item.productId,
          returnDate,
          StoreLedgerTxnType.RETURN,
          returnId,
          item.quantity,
          returnRate.toString(),
          storeIn.newQty.toString(),
          storeIn.newValue.toString(),
          `Returned from Canteen ${returnNo}`,
        ]
      );

      totalValue = totalValue.add(returnValue);
    }

    await query(client, "UPDATE stock_returns SET total_value = $2 WHERE id = $1", [returnId, totalValue.toString()]);

    const updated = await queryOne(client, `${RETURN_SELECT} WHERE sr.id = $1`, [returnId]);
    await writeAudit(client, { entity: "StockReturn", entityId: returnId, action: "CREATE", actorId: input.createdById, after: updated });
    return updated;
  });
}

export interface StoreStockRow {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  openingQty: Decimal;
  inwardQty: Decimal;
  availableQty: Decimal;
  avgRate: Decimal;
  issueQty: Decimal;
  balanceQty: Decimal;
  stockValue: Decimal;
  minStockLevel: Decimal;
  reorderLevel: Decimal;
  isLowStock: boolean;
}

/** Store Stock screen (spec §12): opening/inward/available/issue/balance for
 * the given date window, plus the current average rate & stock value. */
export async function getStoreStockSummary(from: Date, to: Date): Promise<StoreStockRow[]> {
  const products = await query<{
    id: string;
    name: string;
    categoryName: string;
    unitSymbol: string;
    minStockLevel: string;
    reorderLevel: string;
    quantity: string | null;
    avgRate: string | null;
    stockValue: string | null;
  }>(
    pool,
    `SELECT p.id, p.name, c.name AS "categoryName", u.symbol AS "unitSymbol",
        p.min_stock_level AS "minStockLevel", p.reorder_level AS "reorderLevel",
        b.quantity, b.avg_rate AS "avgRate", b.stock_value AS "stockValue"
     FROM products p
     JOIN categories c ON c.id = p.category_id
     JOIN units u ON u.id = p.unit_id
     LEFT JOIN store_stock_balances b ON b.product_id = p.id
     WHERE p.active = TRUE AND c.is_food = FALSE
     ORDER BY p.name ASC`
  );

  const rows: StoreStockRow[] = [];
  for (const product of products) {
    const prior = await queryOne<{ balanceQty: string }>(
      pool,
      `SELECT balance_qty AS "balanceQty" FROM store_stock_ledger WHERE product_id = $1 AND txn_date < $2 ORDER BY txn_date DESC LIMIT 1`,
      [product.id, from]
    );
    const openingQty = D(prior?.balanceQty ?? 0);

    const agg = await queryOne<{ inwardSum: string | null; issueSum: string | null }>(
      pool,
      `SELECT SUM(inward_qty) AS "inwardSum", SUM(issue_qty) AS "issueSum"
       FROM store_stock_ledger WHERE product_id = $1 AND txn_date >= $2 AND txn_date <= $3`,
      [product.id, from, to]
    );
    const inwardQty = D(agg?.inwardSum ?? 0);
    const issueQty = D(agg?.issueSum ?? 0);
    const availableQty = openingQty.add(inwardQty);
    const balanceQty = availableQty.sub(issueQty);

    rows.push({
      productId: product.id,
      productName: product.name,
      category: product.categoryName,
      unit: product.unitSymbol,
      openingQty,
      inwardQty,
      availableQty,
      avgRate: D(product.avgRate ?? 0),
      issueQty,
      balanceQty,
      stockValue: D(product.stockValue ?? 0),
      minStockLevel: D(product.minStockLevel),
      reorderLevel: D(product.reorderLevel),
      isLowStock: D(product.quantity ?? 0).lte(D(product.minStockLevel)),
    });
  }
  return rows;
}

export async function getStoreLedger(productId: string, from?: Date, to?: Date) {
  const params: unknown[] = [productId];
  let where = "product_id = $1";
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
        inward_qty AS "inwardQty", issue_qty AS "issueQty", rate, balance_qty AS "balanceQty", balance_value AS "balanceValue", remarks
     FROM store_stock_ledger WHERE ${where} ORDER BY txn_date ASC`,
    params
  );
}
