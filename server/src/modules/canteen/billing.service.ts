import { PoolClient } from "pg";
import { pool, query, queryOne, withTransaction } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { D, applyIssue, round2, Decimal } from "../../utils/money";
import { writeAudit } from "../../utils/audit";
import { CanteenLedgerTxnType, PaymentMode } from "../../types/domain";

export interface SaleItemInput {
  productId: string;
  quantity: number;
  rate: number;
  discount?: number;
}

export interface CreateSaleInput {
  items: SaleItemInput[];
  paymentMode: PaymentMode;
  customerRef?: string;
  billDate?: Date;
  clientRef?: string; // offline-queue idempotency key
  createdById: string;
}

export const SALE_SELECT = `
  SELECT s.*,
    jsonb_build_object('id', u.id, 'name', u.name) AS "createdBy",
    COALESCE(items.items, '[]'::jsonb) AS items
  FROM sales s
  JOIN users u ON u.id = s.created_by_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', si.id, 'productId', si.product_id, 'quantity', si.quantity, 'rate', si.rate, 'discount', si.discount, 'amount', si.amount,
      'product', jsonb_build_object('id', p.id, 'name', p.name, 'unit', jsonb_build_object('id', pu.id, 'name', pu.name, 'symbol', pu.symbol))
    ) ORDER BY si.created_at) AS items
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN units pu ON pu.id = p.unit_id
    WHERE si.sale_id = s.id
  ) items ON TRUE
`;

async function nextBillNumber(client: PoolClient, billDate: Date) {
  const dayOnly = new Date(billDate.getFullYear(), billDate.getMonth(), billDate.getDate());
  const counter = await queryOne<{ lastSeq: number }>(
    client,
    `INSERT INTO bill_counters (bill_date, last_seq) VALUES ($1, 1)
     ON CONFLICT (bill_date) DO UPDATE SET last_seq = bill_counters.last_seq + 1
     RETURNING last_seq AS "lastSeq"`,
    [dayOnly]
  );
  const yyyy = dayOnly.getFullYear();
  const mm = String(dayOnly.getMonth() + 1).padStart(2, "0");
  const dd = String(dayOnly.getDate()).padStart(2, "0");
  return `DSRJ-${yyyy}${mm}${dd}-${String(counter!.lastSeq).padStart(5, "0")}`;
}

/**
 * POS billing (spec §15). Creates the bill + line items, then — for every
 * line item whose product is flagged `trackCanteenStock` — draws down
 * Canteen stock via the shared ledger-posting path (spec §4/§14).
 * `clientRef`, when supplied by the offline POS queue, makes a retried sync
 * idempotent: a repeat call with the same clientRef returns the original bill.
 */
export async function createSale(input: CreateSaleInput) {
  if (input.items.length === 0) throw ApiError.badRequest("A bill must have at least one item");

  if (input.clientRef) {
    const existing = await queryOne(pool, `${SALE_SELECT} WHERE s.client_ref = $1`, [input.clientRef]);
    if (existing) return existing;
  }

  return withTransaction(async (client) => {
    const billDate = input.billDate ?? new Date();
    const billNo = await nextBillNumber(client, billDate);

    let subTotal = D(0);
    let discountTotal = D(0);

    const sale = await queryOne<{ id: string }>(
      client,
      `INSERT INTO sales (bill_no, bill_date, bill_time, payment_mode, customer_ref, client_ref, created_by_id, sub_total, discount_total, grand_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0) RETURNING id`,
      [billNo, billDate, billDate, input.paymentMode, input.customerRef ?? null, input.clientRef ?? null, input.createdById]
    );
    const saleId = sale!.id;

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");
      if (item.rate < 0) throw ApiError.badRequest("Rate cannot be negative");
      const discount = D(item.discount ?? 0);
      if (discount.lt(0)) throw ApiError.badRequest("Discount cannot be negative");

      const product = await queryOne<{ id: string; trackCanteenStock: boolean }>(
        client,
        "SELECT id, track_canteen_stock AS \"trackCanteenStock\" FROM products WHERE id = $1",
        [item.productId]
      );
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      const lineGross = round2(D(item.quantity).mul(item.rate));
      const amount = round2(lineGross.sub(discount));
      if (amount.lt(0)) throw ApiError.badRequest("Discount cannot exceed line amount");

      await query(client, "INSERT INTO sale_items (sale_id, product_id, quantity, rate, discount, amount) VALUES ($1, $2, $3, $4, $5, $6)", [
        saleId,
        item.productId,
        item.quantity,
        item.rate,
        discount.toString(),
        amount.toString(),
      ]);

      subTotal = subTotal.add(lineGross);
      discountTotal = discountTotal.add(discount);

      if (product.trackCanteenStock) {
        await queryOne(client, "SELECT id FROM products WHERE id = $1 FOR UPDATE", [item.productId]);
        const balance = await queryOne<{ quantity: string; stockValue: string; avgRate: string }>(
          client,
          "SELECT quantity, stock_value, avg_rate FROM canteen_stock_balances WHERE product_id = $1",
          [item.productId]
        );
        const openingQty = balance?.quantity ?? D(0);
        if (D(item.quantity).gt(openingQty)) {
          throw ApiError.badRequest(`Insufficient stock. Available quantity: ${D(openingQty).toString()}.`);
        }
        const openingValue = balance?.stockValue ?? D(0);
        const avgRate = balance?.avgRate ?? D(0);
        const { newQty, newValue } = applyIssue(openingQty, openingValue, avgRate, item.quantity);

        await query(client, "UPDATE canteen_stock_balances SET quantity = $2, stock_value = $3, updated_at = now() WHERE product_id = $1", [
          item.productId,
          newQty.toString(),
          newValue.toString(),
        ]);
        await query(
          client,
          `INSERT INTO canteen_stock_ledger (product_id, txn_date, txn_type, ref_id, in_qty, out_qty, rate, balance_qty, balance_value, remarks)
           VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8, $9)`,
          [item.productId, billDate, CanteenLedgerTxnType.SALE, saleId, item.quantity, avgRate.toString(), newQty.toString(), newValue.toString(), `Sale ${billNo}`]
        );
      }
    }

    const grandTotal = round2(subTotal.sub(discountTotal));

    await query(client, "UPDATE sales SET sub_total = $2, discount_total = $3, grand_total = $4 WHERE id = $1", [
      saleId,
      subTotal.toString(),
      discountTotal.toString(),
      grandTotal.toString(),
    ]);

    const updated = await queryOne(client, `${SALE_SELECT} WHERE s.id = $1`, [saleId]);

    await writeAudit(client, { entity: "Sale", entityId: saleId, action: "CREATE", actorId: input.createdById, after: updated });

    return updated;
  });
}

export async function getDailySalesSummary(from: Date, to: Date) {
  const sales = await query<{
    id: string;
    paymentMode: PaymentMode;
    grandTotal: string;
    items: { productId: string; quantity: string; amount: string; product: { name: string } }[];
  }>(pool, `${SALE_SELECT} WHERE s.bill_date >= $1 AND s.bill_date <= $2 AND s.status = 'COMPLETED'`, [from, to]);

  const totalBills = sales.length;
  let totalSales = D(0);
  let cashSales = D(0);
  let upiSales = D(0);
  let creditSales = D(0);
  const productWise = new Map<string, { name: string; qty: Decimal; amount: Decimal }>();

  for (const sale of sales) {
    totalSales = totalSales.add(sale.grandTotal);
    if (sale.paymentMode === PaymentMode.CASH) cashSales = cashSales.add(sale.grandTotal);
    if (sale.paymentMode === PaymentMode.UPI) upiSales = upiSales.add(sale.grandTotal);
    if (sale.paymentMode === PaymentMode.CREDIT) creditSales = creditSales.add(sale.grandTotal);

    for (const item of sale.items) {
      const existing = productWise.get(item.productId) ?? { name: item.product.name, qty: D(0), amount: D(0) };
      existing.qty = existing.qty.add(item.quantity);
      existing.amount = existing.amount.add(item.amount);
      productWise.set(item.productId, existing);
    }
  }

  return {
    totalBills,
    totalSales,
    cashSales,
    upiSales,
    creditSales,
    productWiseSales: Array.from(productWise.entries()).map(([productId, v]) => ({ productId, ...v })),
  };
}
