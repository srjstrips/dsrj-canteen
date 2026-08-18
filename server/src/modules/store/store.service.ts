import { Prisma, StoreLedgerTxnType, CanteenLedgerTxnType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { applyInward, applyIssue, D } from "../../utils/money";
import { generateDocNo } from "../../utils/docNumber";
import { writeAudit } from "../../utils/audit";

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

/**
 * Records a Stock Inward and posts the moving weighted-average costing
 * update + ledger entry for every line item, all in one DB transaction.
 * See docs/ARCHITECTURE.md §3.1.
 */
export async function recordStockInward(input: RecordInwardInput) {
  if (input.items.length === 0) throw ApiError.badRequest("At least one line item is required");

  return prisma.$transaction(async (tx) => {
    const inwardDate = input.inwardDate ?? new Date();
    const inwardNo = generateDocNo("INW", inwardDate);

    const inward = await tx.stockInward.create({
      data: {
        inwardNo,
        inwardDate,
        supplierId: input.supplierId,
        invoiceNumber: input.invoiceNumber,
        createdById: input.createdById,
        totalValue: 0,
      },
    });

    let totalValue = D(0);

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Product quantity must be greater than 0");
      if (item.rate < 0) throw ApiError.badRequest("Product rate cannot be negative");

      // Serialize concurrent stock movements for this product.
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${item.productId} FOR UPDATE`;

      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      const balance = await tx.storeStockBalance.findUnique({ where: { productId: item.productId } });
      const openingQty = balance?.quantity ?? D(0);
      const openingValue = balance?.stockValue ?? D(0);

      const { newQty, newValue, newAvgRate, inwardValue } = applyInward(openingQty, openingValue, item.quantity, item.rate);

      await tx.storeStockBalance.upsert({
        where: { productId: item.productId },
        create: { productId: item.productId, quantity: newQty, avgRate: newAvgRate, stockValue: newValue },
        update: { quantity: newQty, avgRate: newAvgRate, stockValue: newValue },
      });

      await tx.stockInwardItem.create({
        data: {
          stockInwardId: inward.id,
          productId: item.productId,
          quantity: item.quantity,
          rate: item.rate,
          totalValue: inwardValue,
        },
      });

      await tx.storeStockLedger.create({
        data: {
          productId: item.productId,
          txnDate: inwardDate,
          txnType: StoreLedgerTxnType.INWARD,
          refId: inward.id,
          inwardQty: item.quantity,
          issueQty: 0,
          rate: newAvgRate,
          balanceQty: newQty,
          balanceValue: newValue,
          remarks: `Inward ${inwardNo} (rate ₹${D(item.rate).toFixed(2)})`,
        },
      });

      totalValue = totalValue.add(inwardValue);
    }

    const updated = await tx.stockInward.update({
      where: { id: inward.id },
      data: { totalValue },
      include: { items: { include: { product: true } }, supplier: true, createdBy: { select: { id: true, name: true } } },
    });

    await writeAudit(tx, {
      entity: "StockInward",
      entityId: inward.id,
      action: "CREATE",
      actorId: input.createdById,
      after: JSON.parse(JSON.stringify(updated)),
    });

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

/**
 * Issues stock from Store to Canteen. Validates against available balance,
 * values the issue at the current (unchanged-by-issue) average rate, and —
 * in the same transaction — credits Canteen's own weighted-average balance
 * so the two sides can never disagree. See docs/ARCHITECTURE.md §3.1/§3.2.
 */
export async function issueStockToCanteen(input: IssueStockInput) {
  if (input.items.length === 0) throw ApiError.badRequest("At least one line item is required");

  return prisma.$transaction(async (tx) => {
    const issueDate = input.issueDate ?? new Date();
    const issueNo = generateDocNo("ISS", issueDate);

    const issue = await tx.stockIssue.create({
      data: { issueNo, issueDate, createdById: input.createdById, totalValue: 0 },
    });

    let totalValue = D(0);

    for (const item of input.items) {
      if (item.quantity <= 0) throw ApiError.badRequest("Issue quantity must be greater than 0");

      await tx.$queryRaw`SELECT id FROM products WHERE id = ${item.productId} FOR UPDATE`;

      const product = await tx.product.findUnique({ where: { id: item.productId } });
      if (!product) throw ApiError.notFound(`Product not found: ${item.productId}`);

      const balance = await tx.storeStockBalance.findUnique({ where: { productId: item.productId } });
      const openingQty = balance?.quantity ?? D(0);

      if (D(item.quantity).gt(openingQty)) {
        throw ApiError.badRequest(`Insufficient stock. Available quantity: ${openingQty.toString()}.`);
      }

      const openingValue = balance?.stockValue ?? D(0);
      const currentAvgRate = balance?.avgRate ?? D(0);

      const { newQty, newValue, avgRate, issueValue } = applyIssue(openingQty, openingValue, currentAvgRate, item.quantity);

      await tx.storeStockBalance.update({
        where: { productId: item.productId },
        data: { quantity: newQty, stockValue: newValue },
      });

      const issueItem = await tx.stockIssueItem.create({
        data: {
          stockIssueId: issue.id,
          productId: item.productId,
          quantity: item.quantity,
          issueRate: avgRate,
          issueValue,
          previousBalance: openingQty,
          balanceAfterIssue: newQty,
        },
      });

      await tx.storeStockLedger.create({
        data: {
          productId: item.productId,
          txnDate: issueDate,
          txnType: StoreLedgerTxnType.ISSUE,
          refId: issue.id,
          inwardQty: 0,
          issueQty: item.quantity,
          rate: avgRate,
          balanceQty: newQty,
          balanceValue: newValue,
          remarks: `Issued to Canteen ${issueNo}`,
        },
      });

      totalValue = totalValue.add(issueValue);

      // --- Canteen side: receive the issued stock at the store issue rate ---
      const canteenBalance = await tx.canteenStockBalance.findUnique({ where: { productId: item.productId } });
      const cOpeningQty = canteenBalance?.quantity ?? D(0);
      const cOpeningValue = canteenBalance?.stockValue ?? D(0);

      const received = applyInward(cOpeningQty, cOpeningValue, item.quantity, avgRate);

      await tx.canteenStockBalance.upsert({
        where: { productId: item.productId },
        create: { productId: item.productId, quantity: received.newQty, avgRate: received.newAvgRate, stockValue: received.newValue },
        update: { quantity: received.newQty, avgRate: received.newAvgRate, stockValue: received.newValue },
      });

      await tx.canteenStockLedger.create({
        data: {
          productId: item.productId,
          txnDate: issueDate,
          txnType: CanteenLedgerTxnType.RECEIVED,
          refId: issueItem.id,
          inQty: item.quantity,
          outQty: 0,
          rate: received.newAvgRate,
          balanceQty: received.newQty,
          balanceValue: received.newValue,
          remarks: `Received from Store ${issueNo}`,
        },
      });
    }

    const updated = await tx.stockIssue.update({
      where: { id: issue.id },
      data: { totalValue },
      include: { items: { include: { product: true } }, createdBy: { select: { id: true, name: true } } },
    });

    await writeAudit(tx, {
      entity: "StockIssue",
      entityId: issue.id,
      action: "CREATE",
      actorId: input.createdById,
      after: JSON.parse(JSON.stringify(updated)),
    });

    return updated;
  });
}

export interface StoreStockRow {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  openingQty: Prisma.Decimal;
  inwardQty: Prisma.Decimal;
  availableQty: Prisma.Decimal;
  avgRate: Prisma.Decimal;
  issueQty: Prisma.Decimal;
  balanceQty: Prisma.Decimal;
  stockValue: Prisma.Decimal;
  minStockLevel: Prisma.Decimal;
  reorderLevel: Prisma.Decimal;
  isLowStock: boolean;
}

/** Store Stock screen (spec §12): opening/inward/available/issue/balance for
 * the given date window, plus the current average rate & stock value. */
export async function getStoreStockSummary(from: Date, to: Date): Promise<StoreStockRow[]> {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { category: true, unit: true, storeStockBalance: true },
    orderBy: { name: "asc" },
  });

  const rows: StoreStockRow[] = [];
  for (const product of products) {
    const priorEntry = await prisma.storeStockLedger.findFirst({
      where: { productId: product.id, txnDate: { lt: from } },
      orderBy: { txnDate: "desc" },
    });
    const openingQty = priorEntry?.balanceQty ?? D(0);

    const agg = await prisma.storeStockLedger.aggregate({
      where: { productId: product.id, txnDate: { gte: from, lte: to } },
      _sum: { inwardQty: true, issueQty: true },
    });
    const inwardQty = D(agg._sum.inwardQty ?? 0);
    const issueQty = D(agg._sum.issueQty ?? 0);
    const availableQty = D(openingQty).add(inwardQty);
    const balanceQty = availableQty.sub(issueQty);
    const balance = product.storeStockBalance;

    rows.push({
      productId: product.id,
      productName: product.name,
      category: product.category.name,
      unit: product.unit.symbol,
      openingQty: D(openingQty),
      inwardQty,
      availableQty,
      avgRate: balance?.avgRate ?? D(0),
      issueQty,
      balanceQty,
      stockValue: balance?.stockValue ?? D(0),
      minStockLevel: product.minStockLevel,
      reorderLevel: product.reorderLevel,
      isLowStock: D(balance?.quantity ?? 0).lte(product.minStockLevel),
    });
  }
  return rows;
}

export async function getStoreLedger(productId: string, from?: Date, to?: Date) {
  return prisma.storeStockLedger.findMany({
    where: {
      productId,
      txnDate: from || to ? { gte: from, lte: to } : undefined,
    },
    orderBy: { txnDate: "asc" },
    include: { product: { include: { unit: true } } },
  });
}
