import { PrismaClient, Role } from "@prisma/client";
import { hashPassword } from "../src/utils/password";
import { recordStockInward, issueStockToCanteen } from "../src/modules/store/store.service";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding masters...");

  const [grocery, oil, dairy, beverage, packaging] = await Promise.all(
    ["Grocery", "Oil", "Dairy", "Beverage", "Packaging"].map((name) =>
      prisma.category.upsert({ where: { name }, update: {}, create: { name } })
    )
  );

  const [kg, ltr, pcs] = await Promise.all([
    prisma.unit.upsert({ where: { symbol: "KG" }, update: {}, create: { name: "Kilogram", symbol: "KG" } }),
    prisma.unit.upsert({ where: { symbol: "LTR" }, update: {}, create: { name: "Litre", symbol: "LTR" } }),
    prisma.unit.upsert({ where: { symbol: "PCS" }, update: {}, create: { name: "Pieces", symbol: "PCS" } }),
  ]);

  const supplier = await prisma.supplier.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Sri Ganesh Wholesale Traders",
      contactPerson: "R. Ganesan",
      mobile: "9876543210",
      address: "Coimbatore, Tamil Nadu",
      gstNumber: "33ABCDE1234F1Z5",
      paymentTerms: "Net 30",
    },
  });

  const productDefs: { name: string; categoryId: string; unitId: string; sellPrice?: number; trackCanteenStock?: boolean; minStockLevel?: number; reorderLevel?: number }[] = [
    { name: "Rice", categoryId: grocery.id, unitId: kg.id, minStockLevel: 20, reorderLevel: 40 },
    { name: "Wheat Flour", categoryId: grocery.id, unitId: kg.id, minStockLevel: 15, reorderLevel: 30 },
    { name: "Sugar", categoryId: grocery.id, unitId: kg.id, minStockLevel: 10, reorderLevel: 25 },
    { name: "Sunflower Oil", categoryId: oil.id, unitId: ltr.id, minStockLevel: 10, reorderLevel: 20 },
    { name: "Toor Dal", categoryId: grocery.id, unitId: kg.id, minStockLevel: 10, reorderLevel: 20 },
    { name: "Milk", categoryId: dairy.id, unitId: ltr.id, minStockLevel: 10, reorderLevel: 20 },
    { name: "Tea Powder", categoryId: beverage.id, unitId: kg.id, minStockLevel: 2, reorderLevel: 5 },
    { name: "Water Bottle 1L", categoryId: beverage.id, unitId: pcs.id, sellPrice: 20, minStockLevel: 24, reorderLevel: 48 },
    { name: "Tea (Cup)", categoryId: beverage.id, unitId: pcs.id, sellPrice: 10, trackCanteenStock: false, minStockLevel: 0, reorderLevel: 0 },
    { name: "Packaging Cups", categoryId: packaging.id, unitId: pcs.id, minStockLevel: 100, reorderLevel: 200 },
  ];

  const products: Record<string, string> = {};
  for (const def of productDefs) {
    const product = await prisma.product.upsert({
      where: { name_unitId: { name: def.name, unitId: def.unitId } },
      update: {},
      create: {
        name: def.name,
        categoryId: def.categoryId,
        unitId: def.unitId,
        sellPrice: def.sellPrice,
        trackCanteenStock: def.trackCanteenStock ?? true,
        minStockLevel: def.minStockLevel ?? 0,
        reorderLevel: def.reorderLevel ?? 0,
      },
    });
    products[def.name] = product.id;
  }

  console.log("Seeding demo users...");
  const password = await hashPassword("Password@123");
  const [admin, storeUser, canteenUser] = await Promise.all([
    prisma.user.upsert({ where: { email: "admin@dsrj.local" }, update: {}, create: { name: "Admin", email: "admin@dsrj.local", passwordHash: password, role: Role.ADMIN } }),
    prisma.user.upsert({ where: { email: "store@dsrj.local" }, update: {}, create: { name: "Store User", email: "store@dsrj.local", passwordHash: password, role: Role.STORE } }),
    prisma.user.upsert({ where: { email: "canteen@dsrj.local" }, update: {}, create: { name: "Canteen Manager", email: "canteen@dsrj.local", passwordHash: password, role: Role.CANTEEN } }),
  ]);
  void admin;
  void canteenUser;

  // -------------------------------------------------------------------------
  // Replay the exact Day 1-5 Rice weighted-average scenario from the spec
  // (§25) as seed data, so the numbers in the UI match the spec on first run.
  // -------------------------------------------------------------------------
  const riceId = products["Rice"];
  const existingLedger = await prisma.storeStockLedger.findFirst({ where: { productId: riceId } });

  if (!existingLedger) {
    console.log("Replaying Day 1-5 Rice weighted-average scenario...");
    const day = (n: number) => new Date(2026, 6, n); // July 2026, days 1-5

    await recordStockInward({
      supplierId: supplier.id,
      invoiceNumber: "INV-D1",
      inwardDate: day(1),
      items: [{ productId: riceId, quantity: 100, rate: 50 }],
      createdById: storeUser.id,
    });

    await issueStockToCanteen({
      issueDate: day(2),
      items: [{ productId: riceId, quantity: 20 }],
      createdById: storeUser.id,
    });

    await recordStockInward({
      supplierId: supplier.id,
      invoiceNumber: "INV-D3",
      inwardDate: day(3),
      items: [{ productId: riceId, quantity: 50, rate: 55 }],
      createdById: storeUser.id,
    });

    await issueStockToCanteen({
      issueDate: day(4),
      items: [{ productId: riceId, quantity: 30 }],
      createdById: storeUser.id,
    });

    await recordStockInward({
      supplierId: supplier.id,
      invoiceNumber: "INV-D5",
      inwardDate: day(5),
      items: [{ productId: riceId, quantity: 100, rate: 48 }],
      createdById: storeUser.id,
    });

    const finalBalance = await prisma.storeStockBalance.findUnique({ where: { productId: riceId } });
    console.log("Rice balance after Day 5:", finalBalance);
  }

  console.log("Seed complete.");
  console.log("Demo logins (password: Password@123): admin@dsrj.local / store@dsrj.local / canteen@dsrj.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
