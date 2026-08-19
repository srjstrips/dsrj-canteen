import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool, queryOne } from "../src/db/pool";
import { recordStockInward, issueStockToCanteen, getStoreLedger } from "../src/modules/store/store.service";
import { postStockAdjustment } from "../src/modules/canteen/canteen.service";
import { hashPassword } from "../src/utils/password";
import { Role } from "../src/types/domain";

let productId: string;
let supplierId: string;
let storeUserId: string;

async function resetDb() {
  await pool.query(`
    TRUNCATE TABLE
      audit_logs, stock_adjustments, wastage, sale_items, sales, bill_counters,
      canteen_stock_ledger, canteen_stock_balances, stock_issue_items, stock_issues,
      store_stock_ledger, store_stock_balances, stock_inward_items, stock_inwards,
      products, suppliers, units, categories, users
    RESTART IDENTITY CASCADE;
  `);
}

beforeAll(async () => {
  await resetDb();

  const category = await queryOne<{ id: string }>(pool, "INSERT INTO categories (name) VALUES ($1) RETURNING id", ["Grocery"]);
  const unit = await queryOne<{ id: string }>(pool, "INSERT INTO units (name, symbol) VALUES ($1, $2) RETURNING id", ["Kilogram", "KG"]);
  const supplier = await queryOne<{ id: string }>(pool, "INSERT INTO suppliers (name) VALUES ($1) RETURNING id", ["Test Supplier"]);
  const storeUser = await queryOne<{ id: string }>(
    pool,
    "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    ["Store Test User", "store-test@dsrj.local", await hashPassword("x"), Role.STORE]
  );
  const product = await queryOne<{ id: string }>(
    pool,
    "INSERT INTO products (name, category_id, unit_id, min_stock_level) VALUES ($1, $2, $3, $4) RETURNING id",
    ["Rice", category!.id, unit!.id, 10]
  );

  productId = product!.id;
  supplierId = supplier!.id;
  storeUserId = storeUser!.id;
});

afterAll(async () => {
  await pool.end();
});

describe("Moving weighted-average costing — spec §25 Day 1-5 scenario", () => {
  it("Day 1: Inward 100 KG @ ₹50 -> balance 100 KG @ ₹50.00", async () => {
    await recordStockInward({
      supplierId,
      inwardDate: new Date(2026, 0, 1),
      items: [{ productId, quantity: 100, rate: 50 }],
      createdById: storeUserId,
    });

    const balance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM store_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(balance!.quantity)).toBe(100);
    expect(Number(balance!.avgRate)).toBe(50);
    expect(Number(balance!.stockValue)).toBe(5000);
  });

  it("Day 2: Issue 20 KG -> balance 80 KG, rate unchanged at ₹50.00, value ₹4,000", async () => {
    const issue = await issueStockToCanteen({
      issueDate: new Date(2026, 0, 2),
      items: [{ productId, quantity: 20 }],
      createdById: storeUserId,
    });

    const items = issue!.items as unknown as { issueRate: number; issueValue: number }[];
    expect(Number(items[0].issueRate)).toBe(50);
    expect(Number(items[0].issueValue)).toBe(1000);

    const balance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM store_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(balance!.quantity)).toBe(80);
    expect(Number(balance!.avgRate)).toBe(50);
    expect(Number(balance!.stockValue)).toBe(4000);

    // Canteen received the issued stock at the store's rate.
    const canteenBalance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM canteen_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(canteenBalance!.quantity)).toBe(20);
    expect(Number(canteenBalance!.avgRate)).toBe(50);
    expect(Number(canteenBalance!.stockValue)).toBe(1000);
  });

  it("Day 3: Inward 50 KG @ ₹55 -> new weighted average ₹51.92, available 130 KG, value ₹6,750", async () => {
    await recordStockInward({
      supplierId,
      inwardDate: new Date(2026, 0, 3),
      items: [{ productId, quantity: 50, rate: 55 }],
      createdById: storeUserId,
    });

    const balance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM store_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(balance!.quantity)).toBe(130);
    expect(Number(balance!.avgRate)).toBe(51.92);
    expect(Number(balance!.stockValue)).toBe(6750);
  });

  it("Day 4: Issue 30 KG -> issue value ₹1,557.60, balance 100 KG, value ₹5,192.40", async () => {
    const issue = await issueStockToCanteen({
      issueDate: new Date(2026, 0, 4),
      items: [{ productId, quantity: 30 }],
      createdById: storeUserId,
    });

    const items = issue!.items as unknown as { issueRate: number; issueValue: number }[];
    expect(Number(items[0].issueRate)).toBe(51.92);
    expect(Number(items[0].issueValue)).toBe(1557.6);

    const balance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM store_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(balance!.quantity)).toBe(100);
    expect(Number(balance!.avgRate)).toBe(51.92);
    expect(Number(balance!.stockValue)).toBe(5192.4);

    const canteenBalance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM canteen_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(canteenBalance!.quantity)).toBe(50);
    expect(Number(canteenBalance!.stockValue)).toBe(2557.6);
    expect(Number(canteenBalance!.avgRate)).toBe(51.15);
  });

  it("Day 5: Inward 100 KG @ ₹48 -> new weighted average ₹49.96, balance 200 KG, value ₹9,992.40", async () => {
    await recordStockInward({
      supplierId,
      inwardDate: new Date(2026, 0, 5),
      items: [{ productId, quantity: 100, rate: 48 }],
      createdById: storeUserId,
    });

    const balance = await queryOne<{ quantity: string; avgRate: string; stockValue: string }>(
      pool,
      "SELECT quantity, avg_rate AS \"avgRate\", stock_value AS \"stockValue\" FROM store_stock_balances WHERE product_id = $1",
      [productId]
    );
    expect(Number(balance!.quantity)).toBe(200);
    expect(Number(balance!.avgRate)).toBe(49.96);
    expect(Number(balance!.stockValue)).toBe(9992.4);
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
    const ledger = (await getStoreLedger(productId)) as { txnType: string; rate: string }[];
    // Day1 inward, Day2 issue, Day3 inward, Day4 issue, Day5 inward = 5 entries.
    expect(ledger).toHaveLength(5);

    const [d1, d2, d3, d4, d5] = ledger;
    expect(d1.txnType).toBe("INWARD");
    expect(Number(d1.rate)).toBe(50);
    expect(d2.txnType).toBe("ISSUE");
    expect(Number(d2.rate)).toBe(50);
    expect(d3.txnType).toBe("INWARD");
    expect(Number(d3.rate)).toBe(51.92);
    expect(d4.txnType).toBe("ISSUE");
    expect(Number(d4.rate)).toBe(51.92);
    expect(d5.txnType).toBe("INWARD");
    expect(Number(d5.rate)).toBe(49.96);

    // The historical Day 1 inward item must still show its original ₹50 rate,
    // never rewritten to a later rate (spec §24).
    const day1Item = await queryOne(pool, "SELECT id FROM stock_inward_items WHERE product_id = $1 AND rate = $2", [productId, 50]);
    expect(day1Item).not.toBeNull();
    const day3Item = await queryOne(pool, "SELECT id FROM stock_inward_items WHERE product_id = $1 AND rate = $2", [productId, 55]);
    expect(day3Item).not.toBeNull();
    const day5Item = await queryOne(pool, "SELECT id FROM stock_inward_items WHERE product_id = $1 AND rate = $2", [productId, 48]);
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
