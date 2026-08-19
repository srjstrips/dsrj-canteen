import { PoolClient } from "pg";
import { pool, query, queryOne, withTransaction } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { D, applyIssue, round2 } from "../../utils/money";
import { writeAudit } from "../../utils/audit";
import { CanteenLedgerTxnType, ManagedOrderStatus, ManagedOrderType } from "../../types/domain";

export interface ManagedItemInput {
  productId: string;
  quantity: number;
}

export interface PlaceOrdersInput {
  dinerNames: string[]; // one order is created per name (spec: one order = one person)
  orderType: ManagedOrderType;
  accountId: string;
  shift?: string;
  items: ManagedItemInput[];
  orderDate?: Date;
  placedById: string; // HOD who placed it
}

export const ORDER_SELECT = `
  SELECT o.*,
    jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type) AS account,
    jsonb_build_object('id', pb.id, 'name', pb.name) AS "placedBy",
    CASE WHEN sb.id IS NULL THEN NULL ELSE jsonb_build_object('id', sb.id, 'name', sb.name) END AS "servedBy",
    COALESCE(items.items, '[]'::jsonb) AS items
  FROM managed_orders o
  JOIN billing_accounts a ON a.id = o.account_id
  JOIN users pb ON pb.id = o.placed_by_id
  LEFT JOIN users sb ON sb.id = o.served_by_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'productId', i.product_id, 'quantity', i.quantity, 'rate', i.rate, 'amount', i.amount,
      'isExtra', i.is_extra, 'extraStatus', i.extra_status,
      'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', jsonb_build_object('symbol', pu.symbol))
    ) ORDER BY i.is_extra, i.created_at) AS items
    FROM managed_order_items i
    JOIN products p ON p.id = i.product_id
    JOIN units pu ON pu.id = p.unit_id
    WHERE i.order_id = o.id
  ) items ON TRUE
`;

async function nextOrderNumber(client: PoolClient, orderDate: Date) {
  const dayOnly = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
  const counter = await queryOne<{ lastSeq: number }>(
    client,
    `INSERT INTO managed_order_counters (order_date, last_seq) VALUES ($1, 1)
     ON CONFLICT (order_date) DO UPDATE SET last_seq = managed_order_counters.last_seq + 1
     RETURNING last_seq AS "lastSeq"`,
    [dayOnly]
  );
  const yyyy = dayOnly.getFullYear();
  const mm = String(dayOnly.getMonth() + 1).padStart(2, "0");
  const dd = String(dayOnly.getDate()).padStart(2, "0");
  return `MO-${yyyy}${mm}${dd}-${String(counter!.lastSeq).padStart(4, "0")}`;
}

/**
 * HOD/HR module: places one managed order per diner name for OT / Guest /
 * Contractor. Items are priced at each product's current sell price (spec:
 * same normal sell price). Orders start in PLACED; the canteen manager serves
 * them and adds any extras, which the placing HOD later confirms.
 */
export async function placeOrders(input: PlaceOrdersInput) {
  const names = input.dinerNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) throw ApiError.badRequest("At least one diner name is required");
  if (input.items.length === 0) throw ApiError.badRequest("An order must have at least one item");

  const account = await queryOne<{ id: string; type: string }>(pool, "SELECT id, type FROM billing_accounts WHERE id = $1 AND active = TRUE", [
    input.accountId,
  ]);
  if (!account) throw ApiError.notFound("Billing account not found or inactive");
  if (input.orderType === ManagedOrderType.CONTRACTOR && account.type !== "CONTRACTOR") {
    throw ApiError.badRequest("Contractor orders must be tagged to a contractor account");
  }
  if (input.orderType !== ManagedOrderType.CONTRACTOR && account.type !== "COMPANY") {
    throw ApiError.badRequest("OT / Guest orders must be tagged to the company account");
  }

  // Resolve each product's sell price once up front.
  const priced: { productId: string; quantity: number; rate: string }[] = [];
  for (const item of input.items) {
    if (item.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");
    const product = await queryOne<{ id: string; sellPrice: string | null }>(
      pool,
      'SELECT id, sell_price AS "sellPrice" FROM products WHERE id = $1 AND active = TRUE',
      [item.productId]
    );
    if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);
    if (product.sellPrice == null) throw ApiError.badRequest("Product has no sell price set");
    priced.push({ productId: item.productId, quantity: item.quantity, rate: product.sellPrice });
  }

  return withTransaction(async (client) => {
    const orderDate = input.orderDate ?? new Date();
    const created: unknown[] = [];

    for (const name of names) {
      const orderNo = await nextOrderNumber(client, orderDate);
      const order = await queryOne<{ id: string }>(
        client,
        `INSERT INTO managed_orders (order_no, order_date, order_type, account_id, diner_name, shift, placed_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [orderNo, orderDate, input.orderType, input.accountId, name, input.shift ?? null, input.placedById]
      );
      const orderId = order!.id;

      for (const p of priced) {
        const amount = round2(D(p.quantity).mul(p.rate));
        await query(
          client,
          `INSERT INTO managed_order_items (order_id, product_id, quantity, rate, amount, is_extra, extra_status)
           VALUES ($1, $2, $3, $4, $5, FALSE, 'CONFIRMED')`,
          [orderId, p.productId, p.quantity, p.rate, amount.toString()]
        );
      }

      const full = await queryOne(client, `${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
      await writeAudit(client, { entity: "ManagedOrder", entityId: orderId, action: "CREATE", actorId: input.placedById, after: full });
      created.push(full);
    }

    return created;
  });
}

export async function listOrders(filters: { from: Date; to: Date; status?: string; diner?: string }) {
  const conditions = ["o.order_date >= $1", "o.order_date <= $2"];
  const params: unknown[] = [filters.from, filters.to];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`o.status = $${params.length}`);
  }
  if (filters.diner) {
    params.push(`%${filters.diner.toLowerCase()}%`);
    conditions.push(`lower(o.diner_name) LIKE $${params.length}`);
  }
  return query(pool, `${ORDER_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY o.created_at DESC`, params);
}

export async function getOrder(id: string) {
  const order = await queryOne(pool, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
  if (!order) throw ApiError.notFound("Order not found");
  return order;
}

export interface UpdateOrderInput {
  dinerName?: string;
  shift?: string | null;
  orderType?: ManagedOrderType;
  accountId?: string;
  items?: ManagedItemInput[];
  actorId: string;
}

/**
 * Edits a still-PLACED order: diner name, shift, type/account and/or the item
 * list. Served orders are locked (stock has moved and extras may exist).
 */
export async function updateOrder(id: string, input: UpdateOrderInput) {
  return withTransaction(async (client) => {
    const order = await queryOne<{ id: string; status: string; orderType: string; accountId: string }>(
      client,
      'SELECT id, status, order_type AS "orderType", account_id AS "accountId" FROM managed_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!order) throw ApiError.notFound("Order not found");
    if (order.status !== ManagedOrderStatus.PLACED) throw ApiError.badRequest("Only orders that are not yet served can be edited");

    const orderType = input.orderType ?? (order.orderType as ManagedOrderType);
    const accountId = input.accountId ?? order.accountId;

    if (input.orderType || input.accountId) {
      const account = await queryOne<{ type: string }>(client, "SELECT type FROM billing_accounts WHERE id = $1 AND active = TRUE", [accountId]);
      if (!account) throw ApiError.notFound("Billing account not found or inactive");
      if (orderType === ManagedOrderType.CONTRACTOR && account.type !== "CONTRACTOR") {
        throw ApiError.badRequest("Contractor orders must be tagged to a contractor account");
      }
      if (orderType !== ManagedOrderType.CONTRACTOR && account.type !== "COMPANY") {
        throw ApiError.badRequest("OT / Guest orders must be tagged to the company account");
      }
    }

    if (input.dinerName !== undefined && !input.dinerName.trim()) throw ApiError.badRequest("Diner name cannot be empty");

    await query(
      client,
      `UPDATE managed_orders SET
         diner_name = COALESCE($2, diner_name),
         shift = CASE WHEN $3 THEN $4 ELSE shift END,
         order_type = $5,
         account_id = $6,
         updated_at = now()
       WHERE id = $1`,
      [id, input.dinerName?.trim() ?? null, input.shift !== undefined, input.shift ?? null, orderType, accountId]
    );

    if (input.items) {
      if (input.items.length === 0) throw ApiError.badRequest("An order must have at least one item");
      await query(client, "DELETE FROM managed_order_items WHERE order_id = $1", [id]);
      for (const item of input.items) {
        if (item.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");
        const product = await queryOne<{ sellPrice: string | null }>(
          client,
          'SELECT sell_price AS "sellPrice" FROM products WHERE id = $1 AND active = TRUE',
          [item.productId]
        );
        if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);
        if (product.sellPrice == null) throw ApiError.badRequest("Product has no sell price set");
        const amount = round2(D(item.quantity).mul(product.sellPrice));
        await query(
          client,
          `INSERT INTO managed_order_items (order_id, product_id, quantity, rate, amount, is_extra, extra_status)
           VALUES ($1, $2, $3, $4, $5, FALSE, 'CONFIRMED')`,
          [id, item.productId, item.quantity, product.sellPrice, amount.toString()]
        );
      }
    }

    const full = await queryOne(client, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
    await writeAudit(client, { entity: "ManagedOrder", entityId: id, action: "UPDATE", actorId: input.actorId, before: order, after: full });
    return full;
  });
}

/**
 * Deletes a still-PLACED order (no stock has moved yet). Served orders are kept
 * for the billing record and cannot be deleted.
 */
export async function deleteOrder(id: string, actorId: string) {
  return withTransaction(async (client) => {
    const order = await queryOne<{ id: string; status: string }>(client, "SELECT id, status FROM managed_orders WHERE id = $1 FOR UPDATE", [id]);
    if (!order) throw ApiError.notFound("Order not found");
    if (order.status !== ManagedOrderStatus.PLACED) throw ApiError.badRequest("Only orders that are not yet served can be deleted");
    await query(client, "DELETE FROM managed_orders WHERE id = $1", [id]);
    await writeAudit(client, { entity: "ManagedOrder", entityId: id, action: "DELETE", actorId, before: order });
  });
}

/**
 * Month-end consolidated statement for one billing account: every SERVED order
 * in the month, counting standard items plus only CONFIRMED extras (PENDING /
 * REJECTED extras are excluded). Returns per-order lines, a product-wise
 * summary and the grand total the company / contractor owes.
 */
export async function getMonthlyStatement(accountId: string, year: number, month: number) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const account = await queryOne(pool, "SELECT * FROM billing_accounts WHERE id = $1", [accountId]);
  if (!account) throw ApiError.notFound("Billing account not found");

  // Only billable lines: standard items, or extras that were confirmed.
  const billable = "(i.is_extra = FALSE OR i.extra_status = 'CONFIRMED')";

  const orders = await query<{
    id: string;
    orderNo: string;
    orderDate: Date;
    orderType: string;
    dinerName: string;
    total: string;
  }>(
    pool,
    `SELECT o.id, o.order_no AS "orderNo", o.order_date AS "orderDate", o.order_type AS "orderType",
            o.diner_name AS "dinerName",
            COALESCE(SUM(i.amount) FILTER (WHERE ${billable}), 0) AS total
     FROM managed_orders o
     JOIN managed_order_items i ON i.order_id = o.id
     WHERE o.account_id = $1 AND o.status = 'SERVED' AND o.order_date >= $2 AND o.order_date <= $3
     GROUP BY o.id
     ORDER BY o.order_date ASC, o.order_no ASC`,
    [accountId, from, to]
  );

  const productWise = await query<{ productId: string; name: string; quantity: string; amount: string }>(
    pool,
    `SELECT i.product_id AS "productId", p.name,
            SUM(i.quantity) AS quantity, SUM(i.amount) AS amount
     FROM managed_orders o
     JOIN managed_order_items i ON i.order_id = o.id
     JOIN products p ON p.id = i.product_id
     WHERE o.account_id = $1 AND o.status = 'SERVED' AND o.order_date >= $2 AND o.order_date <= $3 AND ${billable}
     GROUP BY i.product_id, p.name
     ORDER BY SUM(i.amount) DESC`,
    [accountId, from, to]
  );

  const grandTotal = orders.reduce((sum, o) => sum.add(o.total), D(0));

  return {
    account,
    period: { year, month, from, to },
    orders,
    productWiseSummary: productWise,
    orderCount: orders.length,
    grandTotal: grandTotal.toString(),
  };
}

/** Extras awaiting the placing HOD's confirmation, most recent first. */
export async function listPendingExtras(filters: { from: Date; to: Date }) {
  return query(
    pool,
    `${ORDER_SELECT}
     WHERE o.order_date >= $1 AND o.order_date <= $2
       AND EXISTS (SELECT 1 FROM managed_order_items x WHERE x.order_id = o.id AND x.is_extra = TRUE AND x.extra_status = 'PENDING')
     ORDER BY o.created_at DESC`,
    [filters.from, filters.to]
  );
}

/**
 * Placing HOD confirms or rejects a pending extra item.
 *  - confirm → extra_status CONFIRMED and Canteen stock is drawn down (it now
 *    counts as served and will be billed).
 *  - reject  → extra_status REJECTED; the extra is dismissed and never billed.
 */
export async function resolveExtra(itemId: string, confirm: boolean, actorId: string) {
  return withTransaction(async (client) => {
    const item = await queryOne<{
      id: string;
      orderId: string;
      productId: string;
      quantity: number;
      isExtra: boolean;
      extraStatus: string;
      orderNo: string;
      orderDate: Date;
    }>(
      client,
      `SELECT i.id, i.order_id AS "orderId", i.product_id AS "productId", i.quantity,
              i.is_extra AS "isExtra", i.extra_status AS "extraStatus",
              o.order_no AS "orderNo", o.order_date AS "orderDate"
       FROM managed_order_items i
       JOIN managed_orders o ON o.id = i.order_id
       WHERE i.id = $1 FOR UPDATE OF i`,
      [itemId]
    );
    if (!item) throw ApiError.notFound("Extra item not found");
    if (!item.isExtra) throw ApiError.badRequest("Item is not an extra");
    if (item.extraStatus !== "PENDING") throw ApiError.badRequest(`Extra is already ${item.extraStatus.toLowerCase()}`);

    if (confirm) {
      await drawDownCanteenStock(client, item.productId, item.quantity, item.orderDate, item.orderId, `Managed order ${item.orderNo} (extra)`);
    }

    await query(
      client,
      "UPDATE managed_order_items SET extra_status = $2, confirmed_by_id = $3, confirmed_at = now() WHERE id = $1",
      [itemId, confirm ? "CONFIRMED" : "REJECTED", actorId]
    );

    const full = await queryOne(client, `${ORDER_SELECT} WHERE o.id = $1`, [item.orderId]);
    await writeAudit(client, {
      entity: "ManagedOrder",
      entityId: item.orderId,
      action: confirm ? "CONFIRM_EXTRA" : "REJECT_EXTRA",
      actorId,
      after: full,
    });
    return full;
  });
}

/**
 * Draws down Canteen stock for one served item via the shared weighted-average
 * issue path (same as billing.service). No-op for products not flagged
 * track_canteen_stock (prepared items whose ingredients are drawn separately).
 */
async function drawDownCanteenStock(
  client: PoolClient,
  productId: string,
  quantity: number,
  txnDate: Date,
  refId: string,
  remarks: string
) {
  const product = await queryOne<{ trackCanteenStock: boolean }>(
    client,
    'SELECT track_canteen_stock AS "trackCanteenStock" FROM products WHERE id = $1',
    [productId]
  );
  if (!product?.trackCanteenStock) return;

  await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [productId]);
  const balance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
    client,
    "SELECT quantity, stock_value, avg_rate FROM canteen_stock_balances WHERE product_id = $1",
    [productId]
  );
  const openingQty = balance?.quantity ?? D(0);
  if (D(quantity).gt(openingQty)) {
    throw ApiError.badRequest(`Insufficient stock. Available quantity: ${D(openingQty).toString()}.`);
  }
  const openingValue = balance?.stockValue ?? D(0);
  const avgRate = balance?.avgRate ?? D(0);
  const { newQty, newValue } = applyIssue(openingQty, openingValue, avgRate, quantity);

  await query(client, "UPDATE canteen_stock_balances SET quantity = $2, stock_value = $3, updated_at = now() WHERE product_id = $1", [
    productId,
    newQty.toString(),
    newValue.toString(),
  ]);
  await query(
    client,
    `INSERT INTO canteen_stock_ledger (product_id, txn_date, txn_type, ref_id, in_qty, out_qty, rate, balance_qty, balance_value, remarks)
     VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
    [productId, txnDate, CanteenLedgerTxnType.SALE, refId, quantity, avgRate.toString(), newQty.toString(), newValue.toString(), remarks]
  );
}

/**
 * Canteen manager serves a PLACED order: marks it SERVED and draws down Canteen
 * stock for every standard (non-extra) item. Extras are handled separately —
 * their stock is only drawn once the placing HOD confirms them.
 */
export async function serveOrder(id: string, servedById: string) {
  return withTransaction(async (client) => {
    const order = await queryOne<{ id: string; orderNo: string; status: string; orderDate: Date }>(
      client,
      'SELECT id, order_no AS "orderNo", status, order_date AS "orderDate" FROM managed_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!order) throw ApiError.notFound("Order not found");
    if (order.status !== ManagedOrderStatus.PLACED) throw ApiError.badRequest(`Order is already ${order.status.toLowerCase()}`);

    const items = await query<{ productId: string; quantity: number }>(
      client,
      'SELECT product_id AS "productId", quantity FROM managed_order_items WHERE order_id = $1 AND is_extra = FALSE',
      [id]
    );
    for (const item of items) {
      await drawDownCanteenStock(client, item.productId, item.quantity, order.orderDate, id, `Managed order ${order.orderNo}`);
    }

    await query(client, "UPDATE managed_orders SET status = 'SERVED', served_by_id = $2, served_at = now(), updated_at = now() WHERE id = $1", [
      id,
      servedById,
    ]);

    const full = await queryOne(client, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
    await writeAudit(client, { entity: "ManagedOrder", entityId: id, action: "SERVE", actorId: servedById, after: full });
    return full;
  });
}

/**
 * Canteen manager records extra items eaten during the meal. Each is stored as
 * an is_extra line in PENDING status and awaits the placing HOD's confirmation
 * (spec: reject → dismissed; confirm → shows in served items and is billed).
 * Stock is drawn only on confirmation.
 */
export async function addExtras(id: string, items: ManagedItemInput[], actorId: string) {
  if (items.length === 0) throw ApiError.badRequest("At least one extra item is required");

  return withTransaction(async (client) => {
    const order = await queryOne<{ id: string; status: string }>(client, "SELECT id, status FROM managed_orders WHERE id = $1 FOR UPDATE", [id]);
    if (!order) throw ApiError.notFound("Order not found");
    if (order.status !== ManagedOrderStatus.SERVED) throw ApiError.badRequest("Extras can only be added to a served order");

    for (const item of items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");
      const product = await queryOne<{ sellPrice: string | null }>(
        client,
        'SELECT sell_price AS "sellPrice" FROM products WHERE id = $1 AND active = TRUE',
        [item.productId]
      );
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);
      if (product.sellPrice == null) throw ApiError.badRequest("Product has no sell price set");
      const amount = round2(D(item.quantity).mul(product.sellPrice));
      await query(
        client,
        `INSERT INTO managed_order_items (order_id, product_id, quantity, rate, amount, is_extra, extra_status)
         VALUES ($1, $2, $3, $4, $5, TRUE, 'PENDING')`,
        [id, item.productId, item.quantity, product.sellPrice, amount.toString()]
      );
    }

    const full = await queryOne(client, `${ORDER_SELECT} WHERE o.id = $1`, [id]);
    await writeAudit(client, { entity: "ManagedOrder", entityId: id, action: "ADD_EXTRA", actorId, after: full });
    return full;
  });
}
