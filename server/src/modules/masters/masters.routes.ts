import fs from "fs";
import path from "path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";
import { Role } from "../../types/domain";

// Product image uploads → server/uploads/products, served at /uploads/products.
const UPLOADS_DIR = path.resolve(__dirname, "../../../uploads/products");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ---------------------------------------------------------------------------
// Categories (ADMIN write, everyone authenticated can read)
// ---------------------------------------------------------------------------

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

const nameSchema = z.object({ name: z.string().min(1), active: z.boolean().optional(), isFood: z.boolean().optional() });
const nameSchemaPatch = nameSchema.partial();

categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await query(pool, "SELECT * FROM categories ORDER BY name ASC"));
  })
);

categoriesRouter.post(
  "/",
  requireRole(Role.ADMIN),
  validateBody(nameSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof nameSchema>;
    const category = await queryOne(pool, "INSERT INTO categories (name, is_food, active) VALUES ($1, COALESCE($2, FALSE), COALESCE($3, TRUE)) RETURNING *", [
      body.name,
      body.isFood ?? null,
      body.active ?? null,
    ]);
    await writeAudit(pool, { entity: "Category", entityId: category!.id as string, action: "CREATE", actorId: req.user!.sub, after: category });
    res.status(201).json(category);
  })
);

categoriesRouter.patch(
  "/:id",
  requireRole(Role.ADMIN),
  validateBody(nameSchemaPatch),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof nameSchemaPatch>;
    const before = await queryOne(pool, "SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Category not found");
    const category = await queryOne(
      pool,
      `UPDATE categories SET name = COALESCE($2, name), active = COALESCE($3, active), is_food = COALESCE($4, is_food), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.name ?? null, body.active ?? null, body.isFood ?? null]
    );
    await writeAudit(pool, { entity: "Category", entityId: category!.id as string, action: "UPDATE", actorId: req.user!.sub, before, after: category });
    res.json(category);
  })
);

// ---------------------------------------------------------------------------
// Units (ADMIN write, everyone authenticated can read)
// ---------------------------------------------------------------------------

export const unitsRouter = Router();
unitsRouter.use(requireAuth);

const unitSchema = z.object({ name: z.string().min(1), symbol: z.string().min(1), active: z.boolean().optional() });

unitsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await query(pool, "SELECT * FROM units ORDER BY name ASC"));
  })
);

unitsRouter.post(
  "/",
  requireRole(Role.ADMIN),
  validateBody(unitSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof unitSchema>;
    const unit = await queryOne(pool, "INSERT INTO units (name, symbol, active) VALUES ($1, $2, COALESCE($3, TRUE)) RETURNING *", [
      body.name,
      body.symbol,
      body.active ?? null,
    ]);
    await writeAudit(pool, { entity: "Unit", entityId: unit!.id as string, action: "CREATE", actorId: req.user!.sub, after: unit });
    res.status(201).json(unit);
  })
);

unitsRouter.patch(
  "/:id",
  requireRole(Role.ADMIN),
  validateBody(unitSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof unitSchema>>;
    const before = await queryOne(pool, "SELECT * FROM units WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Unit not found");
    const unit = await queryOne(
      pool,
      `UPDATE units SET name = COALESCE($2, name), symbol = COALESCE($3, symbol), active = COALESCE($4, active), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.name ?? null, body.symbol ?? null, body.active ?? null]
    );
    await writeAudit(pool, { entity: "Unit", entityId: unit!.id as string, action: "UPDATE", actorId: req.user!.sub, before, after: unit });
    res.json(unit);
  })
);

// ---------------------------------------------------------------------------
// Suppliers (ADMIN + STORE write, everyone authenticated can read)
// ---------------------------------------------------------------------------

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

const supplierSchema = z.object({
  name: z.string().min(1),
  contactPerson: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  gstNumber: z.string().optional(),
  paymentTerms: z.string().optional(),
  active: z.boolean().optional(),
});

suppliersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await query(pool, "SELECT * FROM suppliers ORDER BY name ASC"));
  })
);

suppliersRouter.post(
  "/",
  requireRole(Role.STORE),
  validateBody(supplierSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof supplierSchema>;
    const supplier = await queryOne(
      pool,
      `INSERT INTO suppliers (name, contact_person, mobile, address, gst_number, payment_terms, active)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, TRUE)) RETURNING *`,
      [b.name, b.contactPerson ?? null, b.mobile ?? null, b.address ?? null, b.gstNumber ?? null, b.paymentTerms ?? null, b.active ?? null]
    );
    await writeAudit(pool, { entity: "Supplier", entityId: supplier!.id as string, action: "CREATE", actorId: req.user!.sub, after: supplier });
    res.status(201).json(supplier);
  })
);

suppliersRouter.patch(
  "/:id",
  requireRole(Role.STORE),
  validateBody(supplierSchema.partial()),
  asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof supplierSchema>>;
    const before = await queryOne(pool, "SELECT * FROM suppliers WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Supplier not found");
    const supplier = await queryOne(
      pool,
      `UPDATE suppliers SET
         name = COALESCE($2, name),
         contact_person = COALESCE($3, contact_person),
         mobile = COALESCE($4, mobile),
         address = COALESCE($5, address),
         gst_number = COALESCE($6, gst_number),
         payment_terms = COALESCE($7, payment_terms),
         active = COALESCE($8, active),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        b.name ?? null,
        b.contactPerson ?? null,
        b.mobile ?? null,
        b.address ?? null,
        b.gstNumber ?? null,
        b.paymentTerms ?? null,
        b.active ?? null,
      ]
    );
    await writeAudit(pool, { entity: "Supplier", entityId: supplier!.id as string, action: "UPDATE", actorId: req.user!.sub, before, after: supplier });
    res.json(supplier);
  })
);

suppliersRouter.delete(
  "/:id",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const before = await queryOne(pool, "SELECT * FROM suppliers WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Supplier not found");
    const inUse = await queryOne(pool, "SELECT id FROM stock_inwards WHERE supplier_id = $1 LIMIT 1", [req.params.id]);
    if (inUse) throw ApiError.badRequest("Supplier has stock inward records — deactivate instead of deleting");
    await query(pool, "DELETE FROM suppliers WHERE id = $1", [req.params.id]);
    await writeAudit(pool, { entity: "Supplier", entityId: req.params.id, action: "DELETE", actorId: req.user!.sub, before });
    res.json({ success: true });
  })
);

// ---------------------------------------------------------------------------
// Products (ADMIN + STORE write, everyone authenticated can read)
// ---------------------------------------------------------------------------

export const productsRouter = Router();
productsRouter.use(requireAuth);

const productSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().uuid(),
  unitId: z.string().uuid(),
  minStockLevel: z.number().min(0).optional(),
  reorderLevel: z.number().min(0).optional(),
  trackCanteenStock: z.boolean().optional(),
  sellPrice: z.number().min(0).optional().nullable(),
  active: z.boolean().optional(),
});

const PRODUCT_SELECT = `
  SELECT p.*,
    jsonb_build_object('id', c.id, 'name', c.name, 'active', c.active) AS category,
    jsonb_build_object('id', u.id, 'name', u.name, 'symbol', u.symbol, 'active', u.active) AS unit
  FROM products p
  JOIN categories c ON c.id = p.category_id
  JOIN units u ON u.id = p.unit_id
`;

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const conditions: string[] = [];
    if (req.query.active === "true") conditions.push("p.active = TRUE");
    // Sellable = has a price (POS / OT orders). Raw materials have no price.
    if (req.query.sellable === "true") conditions.push("p.sell_price IS NOT NULL");
    // Food item = priced AND not stock-tracked (prepared food, cooked from raw materials).
    if (req.query.foodItem === "true") conditions.push("p.sell_price IS NOT NULL AND p.track_canteen_stock = FALSE");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const products = await query(pool, `${PRODUCT_SELECT} ${where} ORDER BY p.name ASC`);
    res.json(products);
  })
);

productsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    if (!product) throw ApiError.notFound("Product not found");
    res.json(product);
  })
);

// ---------------------------------------------------------------------------
// Food Items — prepared food sold at POS (name + price only). Stored as a
// product with track_canteen_stock = FALSE so it never deducts canteen stock.
// A "Food" category and "Plate" unit are auto-provisioned.
// ---------------------------------------------------------------------------

// Food categories are flagged is_food = TRUE so they stay separate from
// store/raw-material categories in the UIs. Matched case-insensitively so
// "Breakfast" and "BreakFast" don't create two categories.
async function getOrCreateCategory(name: string): Promise<string> {
  const trimmed = name.trim();
  const existing = await queryOne<{ id: string }>(pool, "SELECT id FROM categories WHERE lower(name) = lower($1)", [trimmed]);
  if (existing) {
    await query(pool, "UPDATE categories SET is_food = TRUE WHERE id = $1", [existing.id]);
    return existing.id;
  }
  const row = await queryOne<{ id: string }>(pool, "INSERT INTO categories (name, is_food) VALUES ($1, TRUE) RETURNING id", [trimmed]);
  return row!.id;
}

async function foodUnitId(): Promise<string> {
  const existing = await queryOne<{ id: string }>(pool, "SELECT id FROM units WHERE lower(name) = 'plate' OR symbol = 'PLT' LIMIT 1");
  if (existing) return existing.id;
  const unit = await queryOne<{ id: string }>(pool, "INSERT INTO units (name, symbol) VALUES ('Plate', 'PLT') RETURNING id");
  return unit!.id;
}

const foodItemSchema = z.object({
  name: z.string().min(1),
  sellPrice: z.number().nonnegative(),
  category: z.string().min(1), // meal category, e.g. Breakfast / Lunch / Snacks / Sweet
  active: z.boolean().optional(),
});

productsRouter.post(
  "/food-item",
  requireRole(Role.CANTEEN),
  validateBody(foodItemSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof foodItemSchema>;
    const unitId = await foodUnitId();
    const dup = await queryOne(pool, "SELECT id FROM products WHERE lower(name) = lower($1) AND unit_id = $2", [b.name.trim(), unitId]);
    if (dup) throw ApiError.badRequest(`A food item named "${b.name.trim()}" already exists`);
    const categoryId = await getOrCreateCategory(b.category);
    const inserted = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO products (name, category_id, unit_id, sell_price, track_canteen_stock, active)
       VALUES ($1, $2, $3, $4, FALSE, COALESCE($5, TRUE)) RETURNING id`,
      [b.name, categoryId, unitId, b.sellPrice, b.active ?? null]
    );
    const product = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [inserted!.id]);
    await writeAudit(pool, { entity: "Product", entityId: inserted!.id, action: "CREATE", actorId: req.user!.sub, after: product });
    res.status(201).json(product);
  })
);

// Canteen-accessible category create (so the menu can add meal categories
// without ADMIN). Idempotent — returns the existing one if the name is taken.
productsRouter.post(
  "/food-category",
  requireRole(Role.CANTEEN),
  validateBody(z.object({ name: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const name = (req.body as { name: string }).name.trim();
    const id = await getOrCreateCategory(name);
    const category = await queryOne(pool, "SELECT * FROM categories WHERE id = $1", [id]);
    res.status(201).json(category);
  })
);

productsRouter.delete(
  "/food-item/:id",
  requireRole(Role.CANTEEN),
  asyncHandler(async (req, res) => {
    const before = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    if (!before) throw ApiError.notFound("Food item not found");
    const usedInBill = await queryOne(pool, "SELECT 1 FROM sale_items WHERE product_id = $1 LIMIT 1", [req.params.id]);
    const usedInOrder = await queryOne(pool, "SELECT 1 FROM managed_order_items WHERE product_id = $1 LIMIT 1", [req.params.id]);
    if (usedInBill || usedInOrder) {
      throw ApiError.badRequest("This food item has already been billed and cannot be deleted — deactivate it instead");
    }
    await query(pool, "DELETE FROM products WHERE id = $1", [req.params.id]);
    await writeAudit(pool, { entity: "Product", entityId: req.params.id, action: "DELETE", actorId: req.user!.sub, before });
    res.status(204).end();
  })
);

// Upload / replace a product image. Deletes the previous file if any.
productsRouter.post(
  "/:id/image",
  requireRole(Role.CANTEEN),
  imageUpload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("No image uploaded");
    const before = await queryOne<{ imageUrl: string | null }>(pool, 'SELECT image_url AS "imageUrl" FROM products WHERE id = $1', [req.params.id]);
    if (!before) {
      fs.unlink(path.join(UPLOADS_DIR, req.file.filename), () => {});
      throw ApiError.notFound("Product not found");
    }
    if (before.imageUrl) {
      const old = path.join(UPLOADS_DIR, path.basename(before.imageUrl));
      fs.unlink(old, () => {});
    }
    const imageUrl = `/uploads/products/${req.file.filename}`;
    await query(pool, "UPDATE products SET image_url = $2, updated_at = now() WHERE id = $1", [req.params.id, imageUrl]);
    const product = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    res.json(product);
  })
);

// GET food categories with product count
productsRouter.get(
  "/food-categories",
  requireRole(Role.CANTEEN),
  asyncHandler(async (_req, res) => {
    const rows = await query<{ id: string; name: string; active: boolean; productCount: number }>(
      pool,
      `SELECT c.id, c.name, c.active,
              COUNT(p.id)::int AS "productCount"
       FROM categories c
       LEFT JOIN products p ON p.category_id = c.id AND p.active = TRUE
       WHERE c.is_food = TRUE
       GROUP BY c.id
       ORDER BY c.name ASC`
    );
    res.json(rows);
  })
);

// Rename / toggle active a food category
productsRouter.patch(
  "/food-category/:id",
  requireRole(Role.CANTEEN),
  validateBody(z.object({ name: z.string().min(1).optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const body = req.body as { name?: string; active?: boolean };
    const before = await queryOne(pool, "SELECT * FROM categories WHERE id = $1 AND is_food = TRUE", [req.params.id]);
    if (!before) throw ApiError.notFound("Food category not found");
    if (body.name) {
      const conflict = await queryOne(pool, "SELECT id FROM categories WHERE lower(name) = lower($1) AND id != $2 LIMIT 1", [body.name, req.params.id]);
      if (conflict) throw ApiError.badRequest(`A category named "${body.name}" already exists`);
    }
    const updated = await queryOne(
      pool,
      `UPDATE categories SET name = COALESCE($2, name), active = COALESCE($3, active), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.name ?? null, body.active ?? null]
    );
    await writeAudit(pool, { entity: "Category", entityId: req.params.id, action: "UPDATE", actorId: req.user!.sub, before, after: updated });
    res.json(updated);
  })
);

productsRouter.delete(
  "/food-category/:id",
  requireRole(Role.CANTEEN),
  asyncHandler(async (req, res) => {
    const before = await queryOne(pool, "SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Category not found");

    const mode = req.query.mode as string | undefined;

    if (mode === "cascade") {
      // Delete only products that have never been billed or ordered (safe to hard-delete)
      // Products that were billed get unlinked (category_id → NULL) to preserve history
      const billedIds = await query<{ id: string }>(
        pool,
        `SELECT DISTINCT p.id FROM products p
         WHERE p.category_id = $1
           AND (EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = p.id)
             OR EXISTS (SELECT 1 FROM managed_order_items moi WHERE moi.product_id = p.id))`,
        [req.params.id]
      );
      const billedSet = new Set(billedIds.map((r) => r.id));

      const allProducts = await query<{ id: string }>(pool, "SELECT id FROM products WHERE category_id = $1", [req.params.id]);
      for (const p of allProducts) {
        if (billedSet.has(p.id)) {
          // Keep record for history but unlink from category
          await query(pool, "UPDATE products SET category_id = NULL WHERE id = $1", [p.id]);
        } else {
          await query(pool, "DELETE FROM products WHERE id = $1", [p.id]);
          await writeAudit(pool, { entity: "Product", entityId: p.id, action: "DELETE", actorId: req.user!.sub, before: p });
        }
      }
    } else if (mode === "unlink") {
      // Move all products to uncategorized
      await query(pool, "UPDATE products SET category_id = NULL WHERE category_id = $1", [req.params.id]);
    } else {
      const inUse = await queryOne(pool, "SELECT 1 FROM products WHERE category_id = $1 LIMIT 1", [req.params.id]);
      if (inUse) throw ApiError.badRequest("This category has food items — use mode=cascade or mode=unlink");
    }

    await query(pool, "DELETE FROM categories WHERE id = $1", [req.params.id]);
    await writeAudit(pool, { entity: "Category", entityId: req.params.id, action: "DELETE", actorId: req.user!.sub, before });
    res.status(204).end();
  })
);

const foodItemUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  sellPrice: z.number().nonnegative().optional(),
  category: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

productsRouter.patch(
  "/food-item/:id",
  requireRole(Role.CANTEEN),
  validateBody(foodItemUpdateSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof foodItemUpdateSchema>;
    const before = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    if (!before) throw ApiError.notFound("Food item not found");
    const categoryId = b.category ? await getOrCreateCategory(b.category) : null;
    await query(
      pool,
      `UPDATE products SET
         name = COALESCE($2, name),
         sell_price = COALESCE($3, sell_price),
         category_id = COALESCE($4, category_id),
         active = COALESCE($5, active),
         updated_at = now()
       WHERE id = $1`,
      [req.params.id, b.name ?? null, b.sellPrice ?? null, categoryId, b.active ?? null]
    );
    const product = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    await writeAudit(pool, { entity: "Product", entityId: req.params.id, action: "UPDATE", actorId: req.user!.sub, before, after: product });
    res.json(product);
  })
);

productsRouter.post(
  "/",
  requireRole(Role.STORE),
  validateBody(productSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof productSchema>;
    const inserted = await queryOne<{ id: string }>(
      pool,
      `INSERT INTO products (name, category_id, unit_id, min_stock_level, reorder_level, track_canteen_stock, sell_price, active)
       VALUES ($1, $2, $3, COALESCE($4, 0), COALESCE($5, 0), COALESCE($6, TRUE), $7, COALESCE($8, TRUE))
       RETURNING id`,
      [b.name, b.categoryId, b.unitId, b.minStockLevel ?? null, b.reorderLevel ?? null, b.trackCanteenStock ?? null, b.sellPrice ?? null, b.active ?? null]
    );
    const product = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [inserted!.id]);
    await writeAudit(pool, { entity: "Product", entityId: inserted!.id, action: "CREATE", actorId: req.user!.sub, after: product });
    res.status(201).json(product);
  })
);

productsRouter.patch(
  "/:id",
  requireRole(Role.STORE),
  validateBody(productSchema.partial()),
  asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof productSchema>>;
    const before = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    if (!before) throw ApiError.notFound("Product not found");

    await query(
      pool,
      `UPDATE products SET
         name = COALESCE($2, name),
         category_id = COALESCE($3, category_id),
         unit_id = COALESCE($4, unit_id),
         min_stock_level = COALESCE($5, min_stock_level),
         reorder_level = COALESCE($6, reorder_level),
         track_canteen_stock = COALESCE($7, track_canteen_stock),
         sell_price = CASE WHEN $9 THEN $8 ELSE sell_price END,
         active = COALESCE($10, active),
         updated_at = now()
       WHERE id = $1`,
      [
        req.params.id,
        b.name ?? null,
        b.categoryId ?? null,
        b.unitId ?? null,
        b.minStockLevel ?? null,
        b.reorderLevel ?? null,
        b.trackCanteenStock ?? null,
        b.sellPrice ?? null,
        Object.prototype.hasOwnProperty.call(b, "sellPrice"),
        b.active ?? null,
      ]
    );
    const product = await queryOne(pool, `${PRODUCT_SELECT} WHERE p.id = $1`, [req.params.id]);
    await writeAudit(pool, { entity: "Product", entityId: req.params.id, action: "UPDATE", actorId: req.user!.sub, before, after: product });
    res.json(product);
  })
);
