import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { Role } from "../../types/domain";

export const tokensRouter = Router();
tokensRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Helper: get current balance for an account (0 if no transactions yet)
// ---------------------------------------------------------------------------
async function currentBalance(accountId: string): Promise<number> {
  const row = await queryOne<{ balance: string }>(
    pool,
    `SELECT balance_after AS balance
     FROM contractor_token_transactions
     WHERE account_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [accountId]
  );
  return row ? Number(row.balance) : 0;
}

// Helper: verify account exists and is a CONTRACTOR type
async function requireContractorAccount(accountId: string) {
  const acc = await queryOne<{ id: string; name: string; type: string }>(
    pool,
    `SELECT id, name, type FROM billing_accounts WHERE id = $1`,
    [accountId]
  );
  if (!acc) throw ApiError.notFound("Billing account not found");
  if (acc.type !== "CONTRACTOR") throw ApiError.badRequest("Token system is only for CONTRACTOR accounts");
  return acc;
}

// ---------------------------------------------------------------------------
// GET /api/tokens/balances — all contractor balances (ADMIN + CANTEEN)
// ---------------------------------------------------------------------------
tokensRouter.get(
  "/balances",
  requireRole(Role.ADMIN, Role.CANTEEN),
  asyncHandler(async (_req, res) => {
    const rows = await query<{ accountId: string; name: string; balance: string }>(
      pool,
      `SELECT
         ba.id AS "accountId",
         ba.name,
         COALESCE(
           (SELECT t.balance_after
            FROM contractor_token_transactions t
            WHERE t.account_id = ba.id
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT 1),
           0
         ) AS balance
       FROM billing_accounts ba
       WHERE ba.type = 'CONTRACTOR' AND ba.active = TRUE
       ORDER BY ba.name ASC`
    );
    res.json(rows.map((r) => ({ ...r, balance: Number(r.balance) })));
  })
);

// ---------------------------------------------------------------------------
// GET /api/tokens/:accountId/balance — single contractor balance
// ---------------------------------------------------------------------------
tokensRouter.get(
  "/:accountId/balance",
  requireRole(Role.ADMIN, Role.CANTEEN, Role.CONTRACTOR),
  asyncHandler(async (req, res) => {
    await requireContractorAccount(req.params.accountId);
    const balance = await currentBalance(req.params.accountId);
    res.json({ balance });
  })
);

// ---------------------------------------------------------------------------
// GET /api/tokens/:accountId/history — transaction history (optional ?month=YYYY-MM)
// ---------------------------------------------------------------------------
tokensRouter.get(
  "/:accountId/history",
  requireRole(Role.ADMIN, Role.CANTEEN, Role.CONTRACTOR),
  asyncHandler(async (req, res) => {
    await requireContractorAccount(req.params.accountId);

    const conditions = [`t.account_id = $1`];
    const params: unknown[] = [req.params.accountId];

    if (req.query.month && typeof req.query.month === "string") {
      const [year, month] = req.query.month.split("-").map(Number);
      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 1);
      params.push(from, to);
      conditions.push(`t.created_at >= $${params.length - 1} AND t.created_at < $${params.length}`);
    }

    const rows = await query<{
      id: string;
      txnType: string;
      quantity: string;
      pricePerToken: string | null;
      balanceAfter: string;
      note: string | null;
      performedBy: string | null;
      createdAt: string;
    }>(
      pool,
      `SELECT
         t.id,
         t.txn_type AS "txnType",
         t.quantity,
         t.price_per_token AS "pricePerToken",
         t.balance_after AS "balanceAfter",
         t.note,
         u.name AS "performedBy",
         t.created_at AS "createdAt"
       FROM contractor_token_transactions t
       LEFT JOIN users u ON u.id = t.performed_by_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY t.created_at DESC`,
      params
    );

    res.json(
      rows.map((r) => ({
        ...r,
        quantity: Number(r.quantity),
        pricePerToken: r.pricePerToken ? Number(r.pricePerToken) : null,
        balanceAfter: Number(r.balanceAfter),
      }))
    );
  })
);

// ---------------------------------------------------------------------------
// POST /api/tokens/:accountId/topup — add tokens (ADMIN only)
// ---------------------------------------------------------------------------
const topupSchema = z.object({
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  pricePerToken: z.number().nonnegative("Price must be non-negative"),
  note: z.string().optional(),
});

tokensRouter.post(
  "/:accountId/topup",
  requireRole(Role.ADMIN),
  validateBody(topupSchema),
  asyncHandler(async (req, res) => {
    await requireContractorAccount(req.params.accountId);
    const { quantity, pricePerToken, note } = req.body as z.infer<typeof topupSchema>;
    const balance = await currentBalance(req.params.accountId);
    const newBalance = balance + quantity;

    await query(
      pool,
      `INSERT INTO contractor_token_transactions
         (account_id, txn_type, quantity, price_per_token, balance_after, note, performed_by_id)
       VALUES ($1, 'TOPUP', $2, $3, $4, $5, $6)`,
      [req.params.accountId, quantity, pricePerToken, newBalance, note ?? null, req.user!.sub]
    );

    res.json({ balance: newBalance });
  })
);

// ---------------------------------------------------------------------------
// POST /api/tokens/:accountId/reset — reset balance to 0 (ADMIN only)
// ---------------------------------------------------------------------------
const resetSchema = z.object({
  note: z.string().optional(),
});

tokensRouter.post(
  "/:accountId/reset",
  requireRole(Role.ADMIN),
  validateBody(resetSchema),
  asyncHandler(async (req, res) => {
    await requireContractorAccount(req.params.accountId);
    const balance = await currentBalance(req.params.accountId);

    await query(
      pool,
      `INSERT INTO contractor_token_transactions
         (account_id, txn_type, quantity, price_per_token, balance_after, note, performed_by_id)
       VALUES ($1, 'RESET', $2, NULL, 0, $3, $4)`,
      [req.params.accountId, -balance, req.body.note ?? null, req.user!.sub]
    );

    res.json({ balance: 0 });
  })
);

// ---------------------------------------------------------------------------
// POST /api/tokens/:accountId/deduct — serve N labours (CANTEEN)
// ---------------------------------------------------------------------------
const deductSchema = z.object({
  quantity: z.number().int().positive("Quantity must be a positive integer"),
  note: z.string().optional(),
});

tokensRouter.post(
  "/:accountId/deduct",
  requireRole(Role.CANTEEN, Role.ADMIN),
  validateBody(deductSchema),
  asyncHandler(async (req, res) => {
    await requireContractorAccount(req.params.accountId);
    const { quantity, note } = req.body as z.infer<typeof deductSchema>;
    const balance = await currentBalance(req.params.accountId);

    if (balance < quantity) {
      throw ApiError.badRequest(`Insufficient tokens. Available: ${balance}, requested: ${quantity}`);
    }

    const newBalance = balance - quantity;

    await query(
      pool,
      `INSERT INTO contractor_token_transactions
         (account_id, txn_type, quantity, price_per_token, balance_after, note, performed_by_id)
       VALUES ($1, 'DEDUCT', $2, NULL, $3, $4, $5)`,
      [req.params.accountId, -quantity, newBalance, note ?? null, req.user!.sub]
    );

    res.json({ balance: newBalance });
  })
);
