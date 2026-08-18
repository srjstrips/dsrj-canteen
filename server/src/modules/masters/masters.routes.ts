import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";

// ---------------------------------------------------------------------------
// Categories (ADMIN write, everyone authenticated can read)
// ---------------------------------------------------------------------------

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

const nameSchema = z.object({ name: z.string().min(1), active: z.boolean().optional() });

categoriesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.category.findMany({ orderBy: { name: "asc" } }));
  })
);

categoriesRouter.post(
  "/",
  requireRole(Role.ADMIN),
  validateBody(nameSchema),
  asyncHandler(async (req, res) => {
    const category = await prisma.category.create({ data: req.body });
    await writeAudit(prisma, { entity: "Category", entityId: category.id, action: "CREATE", actorId: req.user!.sub, after: category });
    res.status(201).json(category);
  })
);

categoriesRouter.patch(
  "/:id",
  requireRole(Role.ADMIN),
  validateBody(nameSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.category.findUnique({ where: { id: req.params.id } });
    if (!before) throw ApiError.notFound("Category not found");
    const category = await prisma.category.update({ where: { id: req.params.id }, data: req.body });
    await writeAudit(prisma, { entity: "Category", entityId: category.id, action: "UPDATE", actorId: req.user!.sub, before, after: category });
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
    res.json(await prisma.unit.findMany({ orderBy: { name: "asc" } }));
  })
);

unitsRouter.post(
  "/",
  requireRole(Role.ADMIN),
  validateBody(unitSchema),
  asyncHandler(async (req, res) => {
    const unit = await prisma.unit.create({ data: req.body });
    await writeAudit(prisma, { entity: "Unit", entityId: unit.id, action: "CREATE", actorId: req.user!.sub, after: unit });
    res.status(201).json(unit);
  })
);

unitsRouter.patch(
  "/:id",
  requireRole(Role.ADMIN),
  validateBody(unitSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.unit.findUnique({ where: { id: req.params.id } });
    if (!before) throw ApiError.notFound("Unit not found");
    const unit = await prisma.unit.update({ where: { id: req.params.id }, data: req.body });
    await writeAudit(prisma, { entity: "Unit", entityId: unit.id, action: "UPDATE", actorId: req.user!.sub, before, after: unit });
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
    res.json(await prisma.supplier.findMany({ orderBy: { name: "asc" } }));
  })
);

suppliersRouter.post(
  "/",
  requireRole(Role.STORE),
  validateBody(supplierSchema),
  asyncHandler(async (req, res) => {
    const supplier = await prisma.supplier.create({ data: req.body });
    await writeAudit(prisma, { entity: "Supplier", entityId: supplier.id, action: "CREATE", actorId: req.user!.sub, after: supplier });
    res.status(201).json(supplier);
  })
);

suppliersRouter.patch(
  "/:id",
  requireRole(Role.STORE),
  validateBody(supplierSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.supplier.findUnique({ where: { id: req.params.id } });
    if (!before) throw ApiError.notFound("Supplier not found");
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });
    await writeAudit(prisma, { entity: "Supplier", entityId: supplier.id, action: "UPDATE", actorId: req.user!.sub, before, after: supplier });
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

productsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const activeOnly = req.query.active === "true";
    const products = await prisma.product.findMany({
      where: activeOnly ? { active: true } : undefined,
      include: { category: true, unit: true },
      orderBy: { name: "asc" },
    });
    res.json(products);
  })
);

productsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true, unit: true },
    });
    if (!product) throw ApiError.notFound("Product not found");
    res.json(product);
  })
);

productsRouter.post(
  "/",
  requireRole(Role.STORE),
  validateBody(productSchema),
  asyncHandler(async (req, res) => {
    const product = await prisma.product.create({ data: req.body, include: { category: true, unit: true } });
    await writeAudit(prisma, { entity: "Product", entityId: product.id, action: "CREATE", actorId: req.user!.sub, after: product });
    res.status(201).json(product);
  })
);

productsRouter.patch(
  "/:id",
  requireRole(Role.STORE),
  validateBody(productSchema.partial()),
  asyncHandler(async (req, res) => {
    const before = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!before) throw ApiError.notFound("Product not found");
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: req.body,
      include: { category: true, unit: true },
    });
    await writeAudit(prisma, { entity: "Product", entityId: product.id, action: "UPDATE", actorId: req.user!.sub, before, after: product });
    res.json(product);
  })
);
