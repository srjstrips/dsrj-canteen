import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";
import { BillingAccountType, ManagedOrderStatus, ManagedOrderType, Role } from "../../types/domain";
import { sendNotification } from "../../utils/fcm";
import {
  addExtras,
  deleteOrder,
  getMonthlyStatement,
  getOrder,
  listOrders,
  listPendingExtras,
  placeOrders,
  resolveExtra,
  serveOrder,
  updateOrder,
} from "./managed.service";

export const managedRouter = Router();
managedRouter.use(requireAuth);

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

// ---------------------------------------------------------------------------
// Billing accounts (ADMIN write, everyone authenticated can read)
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.nativeEnum(BillingAccountType),
  contactPerson: z.string().optional(),
  mobile: z.string().optional(),
  active: z.boolean().optional(),
});

managedRouter.get(
  "/accounts",
  requireRole(Role.ADMIN, Role.HOD, Role.CANTEEN),
  asyncHandler(async (req, res) => {
    const type = req.query.type as string | undefined;
    const activeOnly = req.query.active === "true";
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (activeOnly) conditions.push("active = TRUE");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    res.json(await query(pool, `SELECT * FROM billing_accounts ${where} ORDER BY name ASC`, params));
  })
);

managedRouter.post(
  "/accounts",
  requireRole(Role.ADMIN),
  validateBody(accountSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof accountSchema>;
    const account = await queryOne(
      pool,
      `INSERT INTO billing_accounts (name, type, contact_person, mobile, active)
       VALUES ($1, $2, $3, $4, COALESCE($5, TRUE)) RETURNING *`,
      [b.name, b.type, b.contactPerson ?? null, b.mobile ?? null, b.active ?? null]
    );
    await writeAudit(pool, { entity: "BillingAccount", entityId: account!.id as string, action: "CREATE", actorId: req.user!.sub, after: account });
    res.status(201).json(account);
  })
);

managedRouter.patch(
  "/accounts/:id",
  requireRole(Role.ADMIN),
  validateBody(accountSchema.partial()),
  asyncHandler(async (req, res) => {
    const b = req.body as Partial<z.infer<typeof accountSchema>>;
    const before = await queryOne(pool, "SELECT * FROM billing_accounts WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Billing account not found");
    const account = await queryOne(
      pool,
      `UPDATE billing_accounts SET
         name = COALESCE($2, name),
         type = COALESCE($3, type),
         contact_person = COALESCE($4, contact_person),
         mobile = COALESCE($5, mobile),
         active = COALESCE($6, active),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, b.name ?? null, b.type ?? null, b.contactPerson ?? null, b.mobile ?? null, b.active ?? null]
    );
    await writeAudit(pool, { entity: "BillingAccount", entityId: account!.id as string, action: "UPDATE", actorId: req.user!.sub, before, after: account });
    res.json(account);
  })
);

managedRouter.delete(
  "/accounts/:id",
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const before = await queryOne(pool, "SELECT * FROM billing_accounts WHERE id = $1", [req.params.id]);
    if (!before) throw ApiError.notFound("Billing account not found");
    const used = await queryOne(pool, "SELECT 1 FROM managed_orders WHERE account_id = $1 LIMIT 1", [req.params.id]);
    if (used) throw ApiError.badRequest("Account has orders and cannot be deleted — deactivate it instead");
    await query(pool, "DELETE FROM billing_accounts WHERE id = $1", [req.params.id]);
    await writeAudit(pool, { entity: "BillingAccount", entityId: req.params.id, action: "DELETE", actorId: req.user!.sub, before });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Monthly consolidated statement for a billing account (?month=YYYY-MM)
// ---------------------------------------------------------------------------

managedRouter.get(
  "/accounts/:id/statement",
  requireRole(Role.ADMIN, Role.HOD),
  asyncHandler(async (req, res) => {
    const monthParam = req.query.month as string | undefined;
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (monthParam) {
      const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
      if (!m) throw ApiError.badRequest("month must be in YYYY-MM format");
      year = Number(m[1]);
      month = Number(m[2]);
    }
    res.json(await getMonthlyStatement(req.params.id, year, month));
  })
);

// ---------------------------------------------------------------------------
// Managed orders — HOD places (one order per diner name)
// ---------------------------------------------------------------------------

const placeOrdersSchema = z.object({
  // Accept a raw comma-separated string or an explicit array; both are split
  // into one order per name (spec: one order = one person).
  dinerNames: z.union([z.string(), z.array(z.string())]).transform((v) =>
    (Array.isArray(v) ? v : v.split(","))
  ),
  orderType: z.nativeEnum(ManagedOrderType),
  accountId: z.string().uuid(),
  shift: z.string().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive("Quantity must be greater than 0"),
      })
    )
    .min(1),
  orderDate: z.coerce.date().optional(),
});

managedRouter.post(
  "/orders",
  requireRole(Role.HOD),
  validateBody(placeOrdersSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof placeOrdersSchema>;
    const orders = await placeOrders({ ...body, placedById: req.user!.sub });
    sendNotification({
      type: "ORDER_PLACED",
      title: "New Order Placed",
      body: `${orders.length} ${body.orderType} order(s) placed by HOD`,
      targetRoles: ["CANTEEN"],
    }).catch(() => {});
    res.status(201).json(orders);
  })
);

managedRouter.get(
  "/orders",
  requireRole(Role.ADMIN, Role.HOD, Role.CANTEEN),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const today = new Date();
    const status = q.status as ManagedOrderStatus | undefined;
    const orders = await listOrders({
      from: q.from ? new Date(q.from) : startOfDay(today),
      to: q.to ? new Date(q.to) : endOfDay(today),
      status,
      diner: q.diner,
    });
    res.json(orders);
  })
);

managedRouter.get(
  "/orders/:id",
  requireRole(Role.ADMIN, Role.HOD, Role.CANTEEN),
  asyncHandler(async (req, res) => {
    res.json(await getOrder(req.params.id));
  })
);

const updateOrderSchema = z.object({
  dinerName: z.string().min(1).optional(),
  shift: z.string().nullable().optional(),
  orderType: z.nativeEnum(ManagedOrderType).optional(),
  accountId: z.string().uuid().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive("Quantity must be greater than 0"),
      })
    )
    .min(1)
    .optional(),
});

managedRouter.patch(
  "/orders/:id",
  requireRole(Role.HOD),
  validateBody(updateOrderSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateOrderSchema>;
    res.json(await updateOrder(req.params.id, { ...body, actorId: req.user!.sub }));
  })
);

managedRouter.delete(
  "/orders/:id",
  requireRole(Role.HOD),
  asyncHandler(async (req, res) => {
    await deleteOrder(req.params.id, req.user!.sub);
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Canteen manager — serve an order and record extras eaten during the meal
// ---------------------------------------------------------------------------

managedRouter.post(
  "/orders/:id/serve",
  requireRole(Role.CANTEEN),
  asyncHandler(async (req, res) => {
    res.json(await serveOrder(req.params.id, req.user!.sub));
  })
);

const extrasSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().positive("Quantity must be greater than 0"),
      })
    )
    .min(1),
});

managedRouter.post(
  "/orders/:id/extras",
  requireRole(Role.CANTEEN),
  validateBody(extrasSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof extrasSchema>;
    res.json(await addExtras(req.params.id, body.items, req.user!.sub));
  })
);

// ---------------------------------------------------------------------------
// HOD — confirm or reject pending extras
// ---------------------------------------------------------------------------

managedRouter.get(
  "/extras/pending",
  requireRole(Role.HOD),
  asyncHandler(async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const today = new Date();
    res.json(
      await listPendingExtras({
        from: q.from ? new Date(q.from) : startOfDay(today),
        to: q.to ? new Date(q.to) : endOfDay(today),
      })
    );
  })
);

const resolveSchema = z.object({ confirm: z.boolean() });

managedRouter.post(
  "/extras/:itemId/resolve",
  requireRole(Role.HOD),
  validateBody(resolveSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof resolveSchema>;
    res.json(await resolveExtra(req.params.itemId, body.confirm, req.user!.sub));
  })
);
