import { CanteenLedgerTxnType, PaymentMode, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { D, applyIssue, round2 } from "../../utils/money";
import { writeAudit } from "../../utils/audit";

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

async function nextBillNumber(tx: Prisma.TransactionClient, billDate: Date) {
  const dayOnly = new Date(billDate.getFullYear(), billDate.getMonth(), billDate.getDate());
  const counter = await tx.billCounter.upsert({
    where: { billDate: dayOnly },
    create: { billDate: dayOnly, lastSeq: 1 },
    update: { lastSeq: { increment: 1 } },
  });
  const yyyy = dayOnly.getFullYear();
  const mm = String(dayOnly.getMonth() + 1).padStart(2, "0");
  const dd = String(dayOnly.getDate()).padStart(2, "0");
  return `DSRJ-${yyyy}${mm}${dd}-${String(counter.lastSeq).padStart(5, "0")}`;
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
    const existing = await prisma.sale.findUnique({ where: { clientRef: input.clientRef }, include: { items: true } });
    if (existing) return existing;
  }

  return prisma.$transaction(async (tx) => {
    const billDate = input.billDate ?? new Date();
    const billNo = await nextBillNumber(tx, billDate);

    let subTotal = D(0);
    let discountTotal = D(0);

    const sale = await tx.sale.create({
      data: {
        billNo,
        billDate,
        billTime: billDate,
        paymentMode: input.paymentMode,
        customerRef: input.customerRef,
        clientRef: input.clientRef,
        createdById: input.createdById,
        subTotal: 0,
        discountTotal: 0,
        grandTotal: 0,
      },
    });

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");
      if (item.rate < 0) throw ApiError.badRequest("Rate cannot be negative");
      const discount = D(item.discount ?? 0);
      if (discount.lt(0)) throw ApiError.badRequest("Discount cannot be negative");

      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      const lineGross = round2(D(item.quantity).mul(item.rate));
      const amount = round2(lineGross.sub(discount));
      if (amount.lt(0)) throw ApiError.badRequest("Discount cannot exceed line amount");

      await tx.saleItem.create({
        data: { saleId: sale.id, productId: item.productId, quantity: item.quantity, rate: item.rate, discount, amount },
      });

      subTotal = subTotal.add(lineGross);
      discountTotal = discountTotal.add(discount);

      if (product.trackCanteenStock) {
        await tx.$queryRaw`SELECT id FROM products WHERE id = ${item.productId} FOR UPDATE`;
        const balance = await tx.canteenStockBalance.findUnique({ where: { productId: item.productId } });
        const openingQty = balance?.quantity ?? D(0);
        if (D(item.quantity).gt(openingQty)) {
          throw ApiError.badRequest(`Insufficient stock. Available quantity: ${openingQty.toString()}.`);
        }
        const openingValue = balance?.stockValue ?? D(0);
        const avgRate = balance?.avgRate ?? D(0);
        const { newQty, newValue } = applyIssue(openingQty, openingValue, avgRate, item.quantity);

        await tx.canteenStockBalance.update({ where: { productId: item.productId }, data: { quantity: newQty, stockValue: newValue } });
        await tx.canteenStockLedger.create({
          data: {
            productId: item.productId,
            txnDate: billDate,
            txnType: CanteenLedgerTxnType.SALE,
            refId: sale.id,
            inQty: 0,
            outQty: item.quantity,
            rate: avgRate,
            balanceQty: newQty,
            balanceValue: newValue,
            remarks: `Sale ${billNo}`,
          },
        });
      }
    }

    const grandTotal = round2(subTotal.sub(discountTotal));

    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { subTotal, discountTotal, grandTotal },
      include: { items: { include: { product: true } }, createdBy: { select: { id: true, name: true } } },
    });

    await writeAudit(tx, { entity: "Sale", entityId: sale.id, action: "CREATE", actorId: input.createdById, after: JSON.parse(JSON.stringify(updated)) });

    return updated;
  });
}

export async function getDailySalesSummary(from: Date, to: Date) {
  const sales = await prisma.sale.findMany({
    where: { billDate: { gte: from, lte: to }, status: "COMPLETED" },
    include: { items: { include: { product: true } } },
  });

  const totalBills = sales.length;
  let totalSales = D(0);
  let cashSales = D(0);
  let upiSales = D(0);
  let creditSales = D(0);
  const productWise = new Map<string, { name: string; qty: ReturnType<typeof D>; amount: ReturnType<typeof D> }>();

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
