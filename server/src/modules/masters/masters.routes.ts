import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";
import { Role } from "../../types/domain";

// ---------------------------------------------------------------------------
// Categories (ADMIN write, everyone authenticated can read)
// ---------------------------------------------------------------------------

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

const nameSchema = z.object({ name: z.string().min(1), active: z.boolean().optional() });

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
    const category = await queryOne(pool, "INSERT INTO categories (name, active) VALUES ($1, COALESCE($2, TRUE)) RETURNING *", [
      body.name,
      body.active ?? null,
    ]);
    await writeAudit(pool, { entity: "Category", entityId: category!.id as string, action: "CREATE", actorId: req.user!.sub, after: category });
    res.status(201).json(category);
  })
);

categoriesRouter.patch(
  "/:id",
  requireRole(Role.ADMIN),
  validateBody(nameSchema.partial()),
  asyncHandler(async (req, res) => {
    const body = req.body as Partial<z.infer<typeof nameSchema>>;
    const before = await queryOne(pool, "SELECT * FROM categories WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Category not found");
    const category = await queryOne(
      pool,
      `UPDATE categories SET name = COALESCE($2, name), active = COALESCE($3, active), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.name ?? null, body.active ?? null]
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
    const activeOnly = req.query.active === "true";
    const products = await query(pool, `${PRODUCT_SELECT} ${activeOnly ? "WHERE p.active = TRUE" : ""} ORDER BY p.name ASC`);
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
