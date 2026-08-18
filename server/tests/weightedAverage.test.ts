import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Role } from "@prisma/client";
import { recordStockInward, issueStockToCanteen, getStoreLedger } from "../src/modules/store/store.service";
import { postStockAdjustment } from "../src/modules/canteen/canteen.service";
import { hashPassword } from "../src/utils/password";

const prisma = new PrismaClient();

let productId: string;
let supplierId: string;
let storeUserId: string;

async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "audit_logs", "stock_adjustments", "wastage", "sale_items", "sales", "bill_counters",
      "canteen_stock_ledger", "canteen_stock_balances", "stock_issue_items", "stock_issues",
      "store_stock_ledger", "store_stock_balances", "stock_inward_items", "stock_inwards",
      "products", "suppliers", "units", "categories", "users"
    RESTART IDENTITY CASCADE;
  `);
}

beforeAll(async () => {
  await resetDb();

  const category = await prisma.category.create({ data: { name: "Grocery" } });
  const unit = await prisma.unit.create({ data: { name: "Kilogram", symbol: "KG" } });
  const supplier = await prisma.supplier.create({ data: { name: "Test Supplier" } });
  const storeUser = await prisma.user.create({
    data: { name: "Store Test User", email: "store-test@dsrj.local", passwordHash: await hashPassword("x"), role: Role.STORE },
  });
  const product = await prisma.product.create({
    data: { name: "Rice", categoryId: category.id, unitId: unit.id, minStockLevel: 10 },
  });

  productId = product.id;
  supplierId = supplier.id;
  storeUserId = storeUser.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Moving weighted-average costing — spec §25 Day 1-5 scenario", () => {
  it("Day 1: Inward 100 KG @ ₹50 -> balance 100 KG @ ₹50.00", async () => {
    await recordStockInward({
      supplierId,
      inwardDate: new Date(2026, 0, 1),
      items: [{ productId, quantity: 100, rate: 50 }],
      createdById: storeUserId,
    });

    const balance = await prisma.storeStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(balance.quantity.toNumber()).toBe(100);
    expect(balance.avgRate.toNumber()).toBe(50);
    expect(balance.stockValue.toNumber()).toBe(5000);
  });

  it("Day 2: Issue 20 KG -> balance 80 KG, rate unchanged at ₹50.00, value ₹4,000", async () => {
    const issue = await issueStockToCanteen({
      issueDate: new Date(2026, 0, 2),
      items: [{ productId, quantity: 20 }],
      createdById: storeUserId,
    });

    expect(issue.items[0].issueRate.toNumber()).toBe(50);
    expect(issue.items[0].issueValue.toNumber()).toBe(1000);

    const balance = await prisma.storeStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(balance.quantity.toNumber()).toBe(80);
    expect(balance.avgRate.toNumber()).toBe(50);
    expect(balance.stockValue.toNumber()).toBe(4000);

    // Canteen received the issued stock at the store's rate.
    const canteenBalance = await prisma.canteenStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(canteenBalance.quantity.toNumber()).toBe(20);
    expect(canteenBalance.avgRate.toNumber()).toBe(50);
    expect(canteenBalance.stockValue.toNumber()).toBe(1000);
  });

  it("Day 3: Inward 50 KG @ ₹55 -> new weighted average ₹51.92, available 130 KG, value ₹6,750", async () => {
    await recordStockInward({
      supplierId,
      inwardDate: new Date(2026, 0, 3),
      items: [{ productId, quantity: 50, rate: 55 }],
      createdById: storeUserId,
    });

    const balance = await prisma.storeStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(balance.quantity.toNumber()).toBe(130);
    expect(balance.avgRate.toNumber()).toBe(51.92);
    expect(balance.stockValue.toNumber()).toBe(6750);
  });

  it("Day 4: Issue 30 KG -> issue value ₹1,557.60, balance 100 KG, value ₹5,192.40", async () => {
    const issue = await issueStockToCanteen({
      issueDate: new Date(2026, 0, 4),
      items: [{ productId, quantity: 30 }],
      createdById: storeUserId,
    });

    expect(issue.items[0].issueRate.toNumber()).toBe(51.92);
    expect(issue.items[0].issueValue.toNumber()).toBe(1557.6);

    const balance = await prisma.storeStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(balance.quantity.toNumber()).toBe(100);
    expect(balance.avgRate.toNumber()).toBe(51.92);
    expect(balance.stockValue.toNumber()).toBe(5192.4);

    const canteenBalance = await prisma.canteenStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(canteenBalance.quantity.toNumber()).toBe(50);
    expect(canteenBalance.stockValue.toNumber()).toBe(2557.6);
    expect(canteenBalance.avgRate.toNumber()).toBe(51.15);
  });

  it("Day 5: Inward 100 KG @ ₹48 -> new weighted average ₹49.96, balance 200 KG, value ₹9,992.40", async () => {
    await recordStockInward({
      supplierId,
      inwardDate: new Date(2026, 0, 5),
      items: [{ productId, quantity: 100, rate: 48 }],
      createdById: storeUserId,
    });

    const balance = await prisma.storeStockBalance.findUniqueOrThrow({ where: { productId } });
    expect(balance.quantity.toNumber()).toBe(200);
    expect(balance.avgRate.toNumber()).toBe(49.96);
    expect(balance.stockValue.toNumber()).toBe(9992.4);
  });

  it("rejects issuing more than the available balance with the exact spec error message", async () => {
    await expect(
      issueStockToCanteen({
        items: [{ productId, quantity: 5000 }],
        createdById: storeUserId,
      })
    ).rejects.toThrow(/^Insufficient stock\. Available quantity: 200(\.0+)?\.$/);
  });

  it("never overwrites historical ledger rows — every movement adds a new append-only entry", async () => {
    const ledger = await getStoreLedger(productId);
    // Day1 inward, Day2 issue, Day3 inward, Day4 issue, Day5 inward = 5 entries.
    expect(ledger).toHaveLength(5);

    const [d1, d2, d3, d4, d5] = ledger;
    expect(d1.txnType).toBe("INWARD");
    expect(d1.rate.toNumber()).toBe(50);
    expect(d2.txnType).toBe("ISSUE");
    expect(d2.rate.toNumber()).toBe(50);
    expect(d3.txnType).toBe("INWARD");
    expect(d3.rate.toNumber()).toBe(51.92);
    expect(d4.txnType).toBe("ISSUE");
    expect(d4.rate.toNumber()).toBe(51.92);
    expect(d5.txnType).toBe("INWARD");
    expect(d5.rate.toNumber()).toBe(49.96);

    // The historical Day 1 inward item must still show its original ₹50 rate,
    // never rewritten to a later rate (spec §24).
    const day1Item = await prisma.stockInwardItem.findFirst({ where: { productId, rate: 50 } });
    expect(day1Item).not.toBeNull();
    const day3Item = await prisma.stockInwardItem.findFirst({ where: { productId, rate: 55 } });
    expect(day3Item).not.toBeNull();
    const day5Item = await prisma.stockInwardItem.findFirst({ where: { productId, rate: 48 } });
    expect(day5Item).not.toBeNull();
  });
});

describe("Validation rules", () => {
  it("rejects zero/negative quantity on inward", async () => {
    await expect(
      recordStockInward({ supplierId, items: [{ productId, quantity: 0, rate: 10 }], createdById: storeUserId })
    ).rejects.toThrow(/greater than 0/);
  });

  it("rejects negative rate on inward", async () => {
    await expect(
      recordStockInward({ supplierId, items: [{ productId, quantity: 10, rate: -1 }], createdById: storeUserId })
    ).rejects.toThrow(/cannot be negative/);
  });

  it("never allows stock to go negative via an adjustment", async () => {
    await expect(
      postStockAdjustment({ area: "STORE", productId, quantityDelta: -100000, reason: "test", createdById: storeUserId })
    ).rejects.toThrow(/Insufficient stock/);
  });
});
