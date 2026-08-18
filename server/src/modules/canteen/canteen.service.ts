import { CanteenLedgerTxnType, StockArea, WastageReason } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { D, applyInward, applyIssue } from "../../utils/money";
import { writeAudit } from "../../utils/audit";

export interface WastageInput {
  productId: string;
  quantity: number;
  reason: WastageReason;
  notes?: string;
  wastageDate?: Date;
  createdById: string;
}

/** Records Wastage and posts a matching WASTAGE ledger entry. Rate/value are
 * always computed from the current canteen average rate, never typed in. */
export async function recordWastage(input: WastageInput) {
  if (input.quantity <= 0) throw ApiError.badRequest("Quantity must be greater than 0");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${input.productId} FOR UPDATE`;

    const balance = await tx.canteenStockBalance.findUnique({ where: { productId: input.productId } });
    const openingQty = balance?.quantity ?? D(0);
    if (D(input.quantity).gt(openingQty)) {
      throw ApiError.badRequest(`Insufficient stock. Available quantity: ${openingQty.toString()}.`);
    }
    const openingValue = balance?.stockValue ?? D(0);
    const rate = balance?.avgRate ?? D(0);

    const { newQty, newValue, issueValue } = applyIssue(openingQty, openingValue, rate, input.quantity);

    await tx.canteenStockBalance.update({ where: { productId: input.productId }, data: { quantity: newQty, stockValue: newValue } });

    const wastageDate = input.wastageDate ?? new Date();
    const wastage = await tx.wastage.create({
      data: {
        productId: input.productId,
        quantity: input.quantity,
        rate,
        wastageValue: issueValue,
        reason: input.reason,
        notes: input.notes,
        createdById: input.createdById,
        wastageDate,
      },
    });

    await tx.canteenStockLedger.create({
      data: {
        productId: input.productId,
        txnDate: wastageDate,
        txnType: CanteenLedgerTxnType.WASTAGE,
        refId: wastage.id,
        inQty: 0,
        outQty: input.quantity,
        rate,
        balanceQty: newQty,
        balanceValue: newValue,
        remarks: `Wastage: ${input.reason}${input.notes ? ` — ${input.notes}` : ""}`,
      },
    });

    await writeAudit(tx, { entity: "Wastage", entityId: wastage.id, action: "CREATE", actorId: input.createdById, after: JSON.parse(JSON.stringify(wastage)) });

    return wastage;
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

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${input.productId} FOR UPDATE`;

    const balance = await tx.canteenStockBalance.findUnique({ where: { productId: input.productId } });
    const openingQty = balance?.quantity ?? D(0);
    if (D(input.quantity).gt(openingQty)) {
      throw ApiError.badRequest(`Insufficient stock. Available quantity: ${openingQty.toString()}.`);
    }
    const openingValue = balance?.stockValue ?? D(0);
    const rate = balance?.avgRate ?? D(0);

    const { newQty, newValue } = applyIssue(openingQty, openingValue, rate, input.quantity);

    await tx.canteenStockBalance.update({ where: { productId: input.productId }, data: { quantity: newQty, stockValue: newValue } });

    const consumptionDate = input.consumptionDate ?? new Date();
    const ledgerEntry = await tx.canteenStockLedger.create({
      data: {
        productId: input.productId,
        txnDate: consumptionDate,
        txnType: CanteenLedgerTxnType.CONSUMPTION,
        inQty: 0,
        outQty: input.quantity,
        rate,
        balanceQty: newQty,
        balanceValue: newValue,
        remarks: input.notes ? `Consumption — ${input.notes}` : "Consumption",
      },
    });

    await writeAudit(tx, { entity: "CanteenConsumption", entityId: ledgerEntry.id, action: "CREATE", actorId: input.createdById, after: JSON.parse(JSON.stringify(ledgerEntry)) });

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

/** ADMIN-authorized stock correction for either Store or Canteen. Never
 * edits history — always adds a new ledger row (spec §22). */
export async function postStockAdjustment(input: AdjustmentInput) {
  if (input.quantityDelta === 0) throw ApiError.badRequest("Adjustment quantity cannot be zero");
  if (!input.reason?.trim()) throw ApiError.badRequest("Adjustment reason is required");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${input.productId} FOR UPDATE`;
    const isStore = input.area === StockArea.STORE;

    const balance = isStore
      ? await tx.storeStockBalance.findUnique({ where: { productId: input.productId } })
      : await tx.canteenStockBalance.findUnique({ where: { productId: input.productId } });

    const openingQty = balance?.quantity ?? D(0);
    const openingValue = balance?.stockValue ?? D(0);
    const currentRate = balance?.avgRate ?? D(0);
    const rate = input.rate !== undefined ? D(input.rate) : currentRate;

    let newQty, newValue, newAvgRate, valueDelta;
    if (input.quantityDelta > 0) {
      const r = applyInward(openingQty, openingValue, input.quantityDelta, rate);
      newQty = r.newQty;
      newValue = r.newValue;
      newAvgRate = r.newAvgRate;
      valueDelta = r.inwardValue;
    } else {
      const qtyOut = Math.abs(input.quantityDelta);
      if (D(qtyOut).gt(openingQty)) {
        throw ApiError.badRequest(`Insufficient stock. Available quantity: ${openingQty.toString()}.`);
      }
      const r = applyIssue(openingQty, openingValue, currentRate, qtyOut);
      newQty = r.newQty;
      newValue = r.newValue;
      newAvgRate = r.avgRate;
      valueDelta = r.issueValue.neg();
    }

    if (isStore) {
      await tx.storeStockBalance.upsert({
        where: { productId: input.productId },
        create: { productId: input.productId, quantity: newQty, avgRate: newAvgRate, stockValue: newValue },
        update: { quantity: newQty, avgRate: newAvgRate, stockValue: newValue },
      });
    } else {
      await tx.canteenStockBalance.upsert({
        where: { productId: input.productId },
        create: { productId: input.productId, quantity: newQty, avgRate: newAvgRate, stockValue: newValue },
        update: { quantity: newQty, avgRate: newAvgRate, stockValue: newValue },
      });
    }

    const adjustment = await tx.stockAdjustment.create({
      data: {
        area: input.area,
        productId: input.productId,
        quantityDelta: input.quantityDelta,
        rate: newAvgRate,
        valueDelta,
        reason: input.reason,
        createdById: input.createdById,
      },
    });

    if (isStore) {
      await tx.storeStockLedger.create({
        data: {
          productId: input.productId,
          txnType: "ADJUSTMENT",
          refId: adjustment.id,
          inwardQty: input.quantityDelta > 0 ? input.quantityDelta : 0,
          issueQty: input.quantityDelta < 0 ? Math.abs(input.quantityDelta) : 0,
          rate: newAvgRate,
          balanceQty: newQty,
          balanceValue: newValue,
          remarks: `Adjustment: ${input.reason}`,
        },
      });
    } else {
      await tx.canteenStockLedger.create({
        data: {
          productId: input.productId,
          txnType: CanteenLedgerTxnType.ADJUSTMENT,
          refId: adjustment.id,
          inQty: input.quantityDelta > 0 ? input.quantityDelta : 0,
          outQty: input.quantityDelta < 0 ? Math.abs(input.quantityDelta) : 0,
          rate: newAvgRate,
          balanceQty: newQty,
          balanceValue: newValue,
          remarks: `Adjustment: ${input.reason}`,
        },
      });
    }

    await writeAudit(tx, { entity: "StockAdjustment", entityId: adjustment.id, action: "CREATE", actorId: input.createdById, after: JSON.parse(JSON.stringify(adjustment)) });

    return adjustment;
  });
}

export interface CanteenStockRow {
  productId: string;
  productName: string;
  category: string;
  unit: string;
  openingQty: ReturnType<typeof D>;
  received: ReturnType<typeof D>;
  consumption: ReturnType<typeof D>;
  sales: ReturnType<typeof D>;
  wastage: ReturnType<typeof D>;
  adjustment: ReturnType<typeof D>;
  balanceQty: ReturnType<typeof D>;
  avgRate: ReturnType<typeof D>;
  stockValue: ReturnType<typeof D>;
  isLowStock: boolean;
}

/** Canteen Stock screen (spec §14): Received − Consumption − Sales − Wastage ± Adjustments. */
export async function getCanteenStockSummary(from: Date, to: Date): Promise<CanteenStockRow[]> {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { category: true, unit: true, canteenStockBalance: true },
    orderBy: { name: "asc" },
  });

  const rows: CanteenStockRow[] = [];
  for (const product of products) {
    const prior = await prisma.canteenStockLedger.findFirst({
      where: { productId: product.id, txnDate: { lt: from } },
      orderBy: { txnDate: "desc" },
    });
    const openingQty = D(prior?.balanceQty ?? 0);

    const grouped = await prisma.canteenStockLedger.groupBy({
      by: ["txnType"],
      where: { productId: product.id, txnDate: { gte: from, lte: to } },
      _sum: { inQty: true, outQty: true },
    });

    const sums = new Map<string, { in: ReturnType<typeof D>; out: ReturnType<typeof D> }>();
    for (const g of grouped) sums.set(g.txnType, { in: D(g._sum.inQty ?? 0), out: D(g._sum.outQty ?? 0) });

    const received = sums.get("RECEIVED")?.in ?? D(0);
    const sales = sums.get("SALE")?.out ?? D(0);
    const consumption = sums.get("CONSUMPTION")?.out ?? D(0);
    const wastage = sums.get("WASTAGE")?.out ?? D(0);
    const adjIn = sums.get("ADJUSTMENT")?.in ?? D(0);
    const adjOut = sums.get("ADJUSTMENT")?.out ?? D(0);

    const balanceQty = openingQty.add(received).add(adjIn).sub(sales).sub(consumption).sub(wastage).sub(adjOut);
    const balance = product.canteenStockBalance;

    rows.push({
      productId: product.id,
      productName: product.name,
      category: product.category.name,
      unit: product.unit.symbol,
      openingQty,
      received,
      consumption,
      sales,
      wastage,
      adjustment: adjIn.sub(adjOut),
      balanceQty,
      avgRate: balance?.avgRate ?? D(0),
      stockValue: balance?.stockValue ?? D(0),
      isLowStock: D(balance?.quantity ?? 0).lte(product.minStockLevel),
    });
  }
  return rows;
}

export async function getCanteenLedger(productId: string, from?: Date, to?: Date, txnType?: CanteenLedgerTxnType) {
  return prisma.canteenStockLedger.findMany({
    where: {
      productId,
      txnType,
      txnDate: from || to ? { gte: from, lte: to } : undefined,
    },
    orderBy: { txnDate: "asc" },
    include: { product: { include: { unit: true } } },
  });
}
