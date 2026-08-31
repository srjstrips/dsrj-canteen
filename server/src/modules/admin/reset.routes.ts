import { Router } from "express";
import { z } from "zod";
import { pool, query, withTransaction } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";
import { Role } from "../../types/domain";

export const resetRouter = Router();
resetRouter.use(requireAuth, requireRole(Role.ADMIN));

// Every table except `users` — transactions AND masters are wiped.
// RESTART IDENTITY resets sequences; CASCADE handles inter-table FKs.
const TABLES_TO_CLEAR = [
  "audit_logs",
  "managed_order_items",
  "managed_orders",
  "managed_order_counters",
  "billing_accounts",
  "sale_items",
  "sales",
  "bill_counters",
  "wastage",
  "stock_adjustments",
  "canteen_stock_ledger",
  "canteen_stock_balances",
  "store_stock_ledger",
  "store_stock_balances",
  "stock_issue_items",
  "stock_issues",
  "stock_inward_items",
  "stock_inwards",
  "products",
  "suppliers",
  "categories",
  "units",
];

import { CLEANUP_SCOPES, runCleanup } from "./cleanup.service";

const resetSchema = z.object({
  // The client must echo this exact word so a reset can't happen by accident.
  confirm: z.literal("DELETE"),
});

const cleanupSchema = z.object({
  confirm: z.literal("DELETE"),
  scopes: z.array(z.enum(CLEANUP_SCOPES)).min(1),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

resetRouter.post(
  "/cleanup",
  validateBody(cleanupSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof cleanupSchema>;
    const result = await runCleanup(body.scopes, { from: body.from, to: body.to }, req.user!.sub);
    res.json(result);
  })
);

resetRouter.post(
  "/reset",
  validateBody(resetSchema),
  asyncHandler(async (req, res) => {
    if (req.user!.role !== Role.ADMIN) throw ApiError.forbidden("Only an admin can reset data");

    await withTransaction(async (client) => {
      await query(client, `TRUNCATE ${TABLES_TO_CLEAR.join(", ")} RESTART IDENTITY CASCADE`);
      // audit_logs was just cleared — record the reset itself for traceability.
      await writeAudit(client, { entity: "System", entityId: "reset", action: "RESET_DATA", actorId: req.user!.sub });
    });

    res.json({ ok: true, cleared: TABLES_TO_CLEAR.length });
  })
);
