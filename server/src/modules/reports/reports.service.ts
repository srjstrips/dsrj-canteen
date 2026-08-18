import { CanteenLedgerTxnType } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { D } from "../../utils/money";

export async function purchaseValueReport(from: Date, to: Date) {
  const items = await prisma.stockInwardItem.findMany({
    where: { stockInward: { inwardDate: { gte: from, lte: to } } },
    include: { product: { include: { unit: true } } },
  });
  const byProduct = new Map<string, { productName: string; unit: string; quantity: ReturnType<typeof D>; value: ReturnType<typeof D> }>();
  for (const item of items) {
    const existing = byProduct.get(item.productId) ?? { productName: item.product.name, unit: item.product.unit.symbol, quantity: D(0), value: D(0) };
    existing.quantity = existing.quantity.add(item.quantity);
    existing.value = existing.value.add(item.totalValue);
    byProduct.set(item.productId, existing);
  }
  return Array.from(byProduct.entries()).map(([productId, v]) => ({ productId, ...v }));
}

export async function supplierWisePurchaseReport(from: Date, to: Date) {
  const inwards = await prisma.stockInward.findMany({
    where: { inwardDate: { gte: from, lte: to } },
    include: { supplier: true },
  });
  const bySupplier = new Map<string, { supplierName: string; invoiceCount: number; totalValue: ReturnType<typeof D> }>();
  for (const inward of inwards) {
    const existing = bySupplier.get(inward.supplierId) ?? { supplierName: inward.supplier.name, invoiceCount: 0, totalValue: D(0) };
    existing.invoiceCount += 1;
    existing.totalValue = existing.totalValue.add(inward.totalValue);
    bySupplier.set(inward.supplierId, existing);
  }
  return Array.from(bySupplier.entries()).map(([supplierId, v]) => ({ supplierId, ...v }));
}

export async function averageRateReport() {
  const balances = await prisma.storeStockBalance.findMany({
    include: { product: { include: { unit: true, category: true } } },
    orderBy: { product: { name: "asc" } },
  });
  return balances.map((b) => ({
    productId: b.productId,
    productName: b.product.name,
    category: b.product.category.name,
    unit: b.product.unit.symbol,
    quantity: b.quantity,
    avgRate: b.avgRate,
    stockValue: b.stockValue,
  }));
}

export async function lowStockReport() {
  const products = await prisma.product.findMany({
    where: { active: true },
    include: { unit: true, category: true, storeStockBalance: true, canteenStockBalance: true },
  });
  return products
    .map((p) => ({
      productId: p.id,
      productName: p.name,
      category: p.category.name,
      unit: p.unit.symbol,
      minStockLevel: p.minStockLevel,
      reorderLevel: p.reorderLevel,
      storeQty: p.storeStockBalance?.quantity ?? D(0),
      canteenQty: p.canteenStockBalance?.quantity ?? D(0),
    }))
    .filter((p) => D(p.storeQty).lte(p.minStockLevel) || D(p.canteenQty).lte(p.minStockLevel));
}

export async function consumptionReport(from: Date, to: Date) {
  return prisma.canteenStockLedger.findMany({
    where: { txnType: CanteenLedgerTxnType.CONSUMPTION, txnDate: { gte: from, lte: to } },
    include: { product: { include: { unit: true, category: true } } },
    orderBy: { txnDate: "desc" },
  });
}

export async function paymentModeReport(from: Date, to: Date) {
  const sales = await prisma.sale.groupBy({
    by: ["paymentMode"],
    where: { billDate: { gte: from, lte: to }, status: "COMPLETED" },
    _sum: { grandTotal: true },
    _count: { _all: true },
  });
  return sales.map((s) => ({ paymentMode: s.paymentMode, totalAmount: s._sum.grandTotal ?? 0, billCount: s._count._all }));
}

export async function purchaseVsSalesReport(from: Date, to: Date) {
  const [purchases, sales] = await Promise.all([
    prisma.stockInward.aggregate({ where: { inwardDate: { gte: from, lte: to } }, _sum: { totalValue: true } }),
    prisma.sale.aggregate({ where: { billDate: { gte: from, lte: to }, status: "COMPLETED" }, _sum: { grandTotal: true } }),
  ]);
  return {
    totalPurchaseValue: purchases._sum.totalValue ?? 0,
    totalSalesValue: sales._sum.grandTotal ?? 0,
  };
}

export async function stockValueReport() {
  const [store, canteen] = await Promise.all([
    prisma.storeStockBalance.aggregate({ _sum: { stockValue: true } }),
    prisma.canteenStockBalance.aggregate({ _sum: { stockValue: true } }),
  ]);
  return {
    storeStockValue: store._sum.stockValue ?? 0,
    canteenStockValue: canteen._sum.stockValue ?? 0,
  };
}

/** Food cost = value consumed by Sales + Consumption, as % of sales revenue. */
export async function foodCostReport(from: Date, to: Date) {
  const [outboundLedger, sales] = await Promise.all([
    prisma.canteenStockLedger.findMany({
      where: { txnType: { in: [CanteenLedgerTxnType.SALE, CanteenLedgerTxnType.CONSUMPTION] }, txnDate: { gte: from, lte: to } },
    }),
    prisma.sale.aggregate({ where: { billDate: { gte: from, lte: to }, status: "COMPLETED" }, _sum: { grandTotal: true } }),
  ]);

  let costOfGoods = D(0);
  for (const row of outboundLedger) costOfGoods = costOfGoods.add(D(row.outQty).mul(row.rate));

  const revenue = D(sales._sum.grandTotal ?? 0);
  const foodCostPct = revenue.isZero() ? D(0) : costOfGoods.mul(100).div(revenue);

  return { costOfGoods, revenue, foodCostPct };
}

export async function wastageCostReport(from: Date, to: Date) {
  const rows = await prisma.wastage.groupBy({
    by: ["reason"],
    where: { wastageDate: { gte: from, lte: to } },
    _sum: { wastageValue: true, quantity: true },
  });
  return rows.map((r) => ({ reason: r.reason, quantity: r._sum.quantity ?? 0, value: r._sum.wastageValue ?? 0 }));
}

export async function monthlyCanteenPerformance(year: number, month: number) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0, 23, 59, 59, 999);
  const [sales, wastage, foodCost] = await Promise.all([
    prisma.sale.aggregate({ where: { billDate: { gte: from, lte: to }, status: "COMPLETED" }, _sum: { grandTotal: true }, _count: { _all: true } }),
    prisma.wastage.aggregate({ where: { wastageDate: { gte: from, lte: to } }, _sum: { wastageValue: true } }),
    foodCostReport(from, to),
  ]);
  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    totalBills: sales._count._all,
    totalSales: sales._sum.grandTotal ?? 0,
    totalWastageValue: wastage._sum.wastageValue ?? 0,
    foodCostPct: foodCost.foodCostPct,
  };
}
