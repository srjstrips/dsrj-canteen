import "dotenv/config";
import { pool, queryOne } from "./pool";
import { hashPassword } from "../utils/password";
import { recordStockInward, issueStockToCanteen } from "../modules/store/store.service";
import { Role } from "../types/domain";

async function upsertCategory(name: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name]
  );
  return row!.id;
}

async function upsertUnit(name: string, symbol: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO units (name, symbol) VALUES ($1, $2) ON CONFLICT (symbol) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [name, symbol]
  );
  return row!.id;
}

async function main() {
  console.log("Seeding masters...");

  const [grocery, oil, dairy, beverage, packaging] = await Promise.all(
    ["Grocery", "Oil", "Dairy", "Beverage", "Packaging"].map(upsertCategory)
  );

  const [kg, ltr, pcs] = await Promise.all([
    upsertUnit("Kilogram", "KG"),
    upsertUnit("Litre", "LTR"),
    upsertUnit("Pieces", "PCS"),
  ]);

  const supplier = await queryOne<{ id: string }>(
    pool,
    `INSERT INTO suppliers (id, name, contact_person, mobile, address, gst_number, payment_terms)
     VALUES ('00000000-0000-0000-0000-000000000001', $1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    ["Sri Ganesh Wholesale Traders", "R. Ganesan", "9876543210", "Coimbatore, Tamil Nadu", "33ABCDE1234F1Z5", "Net 30"]
  );
  const supplierId = supplier?.id ?? "00000000-0000-0000-0000-000000000001";

  const productDefs: { name: string; categoryId: string; unitId: string; sellPrice?: number; trackCanteenStock?: boolean; minStockLevel?: number; reorderLevel?: number }[] = [
    { name: "Rice", categoryId: grocery, unitId: kg, minStockLevel: 20, reorderLevel: 40 },
    { name: "Wheat Flour", categoryId: grocery, unitId: kg, minStockLevel: 15, reorderLevel: 30 },
    { name: "Sugar", categoryId: grocery, unitId: kg, minStockLevel: 10, reorderLevel: 25 },
    { name: "Sunflower Oil", categoryId: oil, unitId: ltr, minStockLevel: 10, reorderLevel: 20 },
    { name: "Toor Dal", categoryId: grocery, unitId: kg, minStockLevel: 10, reorderLevel: 20 },
    { name: "Milk", categoryId: dairy, unitId: ltr, minStockLevel: 10, reorderLevel: 20 },
    { name: "Tea Powder", categoryId: beverage, unitId: kg, minStockLevel: 2, reorderLevel: 5 },
    { name: "Water Bottle 1L", categoryId: beverage, unitId: pcs, sellPrice: 20, minStockLevel: 24, reorderLevel: 48 },
    { name: "Tea (Cup)", categoryId: beverage, unitId: pcs, sellPrice: 10, trackCanteenStock: false, minStockLevel: 0, reorderLevel: 0 },
    { name: "Packaging Cups", categoryId: packaging, unitId: pcs, minStockLevel: 100, reorderLevel: 200 },
  ];

  const products: Record<string, string> = {};
  for (const def of productDefs) {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO products (name, category_id, unit_id, sell_price, track_canteen_stock, min_stock_level, reorder_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name, unit_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [def.name, def.categoryId, def.unitId, def.sellPrice ?? null, def.trackCanteenStock ?? true, def.minStockLevel ?? 0, def.reorderLevel ?? 0]
    );
    products[def.name] = row!.id;
  }

  console.log("Seeding demo users...");
  const password = await hashPassword("Password@123");
  async function upsertUser(name: string, username: string, role: Role): Promise<string> {
    const row = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO users (name, username, password_hash, role) VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [name, username, password, role]
    );
    return row!.id;
  }

  await upsertUser("Admin", "admin", Role.ADMIN);
  const storeUserId = await upsertUser("Store User", "store", Role.STORE);
  await upsertUser("Canteen Manager", "canteen", Role.CANTEEN);
  await upsertUser("HOD / HR", "hod", Role.HOD);

  // Default company account — OT & Guest orders are billed here. Contractors
  // are added separately by Admin under Billing Accounts.
  await queryOne(
    pool,
    `INSERT INTO billing_accounts (name, type) VALUES ($1, 'COMPANY')
     ON CONFLICT (name, type) DO NOTHING RETURNING id`,
    ["Indrayani Upahar Gruh (Company)"]
  );

  // -------------------------------------------------------------------------
  // Replay the exact Day 1-5 Rice weighted-average scenario from the spec
  // (§25) as seed data, so the numbers in the UI match the spec on first run.
  // -------------------------------------------------------------------------
  const riceId = products["Rice"];
  const existingLedger = await queryOne(pool, "SELECT id FROM store_stock_ledger WHERE product_id = $1 LIMIT 1", [riceId]);

  if (!existingLedger) {
    console.log("Replaying Day 1-5 Rice weighted-average scenario...");
    const day = (n: number) => new Date(2026, 6, n); // July 2026, days 1-5

    await recordStockInward({
      supplierId,
      invoiceNumber: "INV-D1",
      inwardDate: day(1),
      items: [{ productId: riceId, quantity: 100, rate: 50 }],
      createdById: storeUserId,
    });

    await issueStockToCanteen({
      issueDate: day(2),
      items: [{ productId: riceId, quantity: 20 }],
      createdById: storeUserId,
    });

    await recordStockInward({
      supplierId,
      invoiceNumber: "INV-D3",
      inwardDate: day(3),
      items: [{ productId: riceId, quantity: 50, rate: 55 }],
      createdById: storeUserId,
    });

    await issueStockToCanteen({
      issueDate: day(4),
      items: [{ productId: riceId, quantity: 30 }],
      createdById: storeUserId,
    });

    await recordStockInward({
      supplierId,
      invoiceNumber: "INV-D5",
      inwardDate: day(5),
      items: [{ productId: riceId, quantity: 100, rate: 48 }],
      createdById: storeUserId,
    });

    const finalBalance = await queryOne(pool, "SELECT * FROM store_stock_balances WHERE product_id = $1", [riceId]);
    console.log("Rice balance after Day 5:", finalBalance);
  }

  console.log("Seed complete.");
  console.log("Demo logins (password: Password@123): admin / store / canteen / hod");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
