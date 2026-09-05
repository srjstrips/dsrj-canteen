import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { Role } from "../../types/domain";
import { sendNotification } from "../../utils/fcm";

export const labourRouter = Router();
labourRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Helper: get current token balance
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

// ---------------------------------------------------------------------------
// POST /api/labour — contractor submits labour entries for a date
// ---------------------------------------------------------------------------
const createSchema = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  count: z.number().int().min(1).max(200),
  names: z.array(z.string()).optional(), // optional names; index maps to entry_no
});

labourRouter.post(
  "/",
  requireRole(Role.CONTRACTOR, Role.ADMIN),
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const { entryDate, count, names } = req.body as z.infer<typeof createSchema>;

    // Determine account_id: CONTRACTOR uses their own, ADMIN must pass accountId
    let accountId: string;
    if (req.user!.role === Role.CONTRACTOR) {
      if (!req.user!.accountId) throw ApiError.badRequest("Your login is not linked to a contractor account");
      accountId = req.user!.accountId;
    } else {
      throw ApiError.forbidden("Only contractor logins can submit labour entries");
    }

    const balance = await currentBalance(accountId);
    if (balance < count) {
      throw ApiError.badRequest(`Insufficient tokens. Available: ${balance}, requested: ${count}`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const entries = [];
      for (let i = 1; i <= count; i++) {
        const name = names && names[i - 1] ? names[i - 1].trim() || null : null;
        const row = await client.query(
          `INSERT INTO contractor_labour_entries
             (account_id, entry_date, entry_no, labour_name, created_by_id)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, entry_no, labour_name, status, entry_date`,
          [accountId, entryDate, i, name, req.user!.sub]
        );
        entries.push(row.rows[0]);
      }

      await client.query("COMMIT");
      sendNotification({
        type: "CONTRACTOR_LABOUR",
        title: "Contractor Labour Submitted",
        body: `${count} labour(s) submitted for ${entryDate} — mark as served when they eat`,
        targetRoles: ["CANTEEN"],
      }).catch(() => {});
      res.status(201).json({ entries });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// ---------------------------------------------------------------------------
// GET /api/labour — list entries for an account + date
// Contractor sees own; Canteen/Admin can pass ?accountId=&date=
// ---------------------------------------------------------------------------
labourRouter.get(
  "/",
  requireRole(Role.CONTRACTOR, Role.CANTEEN, Role.ADMIN),
  asyncHandler(async (req, res) => {
    let accountId: string | undefined;

    if (req.user!.role === Role.CONTRACTOR) {
      if (!req.user!.accountId) throw ApiError.badRequest("No account linked");
      accountId = req.user!.accountId;
    } else {
      accountId = req.query.accountId as string | undefined;
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (accountId) {
      params.push(accountId);
      conditions.push(`e.account_id = $${params.length}`);
    }

    if (req.query.date) {
      params.push(req.query.date);
      conditions.push(`e.entry_date = $${params.length}`);
    }

    if (req.query.status) {
      params.push(req.query.status);
      conditions.push(`e.status = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const entries = await query<{
      id: string;
      accountId: string;
      accountName: string;
      entryDate: string;
      entryNo: number;
      labourName: string | null;
      status: string;
      servedBy: string | null;
      servedAt: string | null;
      createdAt: string;
    }>(
      pool,
      `SELECT
         e.id,
         e.account_id AS "accountId",
         ba.name AS "accountName",
         e.entry_date AS "entryDate",
         e.entry_no AS "entryNo",
         e.labour_name AS "labourName",
         e.status,
         u.name AS "servedBy",
         e.served_at AS "servedAt",
         e.created_at AS "createdAt"
       FROM contractor_labour_entries e
       JOIN billing_accounts ba ON ba.id = e.account_id
       LEFT JOIN users u ON u.id = e.served_by_id
       ${where}
       ORDER BY e.entry_date DESC, e.account_id, e.entry_no ASC`,
      params
    );

    res.json(entries);
  })
);

// ---------------------------------------------------------------------------
// POST /api/labour/:id/serve — canteen marks one entry as served
// ---------------------------------------------------------------------------
labourRouter.post(
  "/:id/serve",
  requireRole(Role.CANTEEN, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const entry = await queryOne<{
      id: string; accountId: string; status: string; servedAt: string | null; entryNo: number;
    }>(
      pool,
      `SELECT id, account_id AS "accountId", status, served_at AS "servedAt", entry_no AS "entryNo"
       FROM contractor_labour_entries WHERE id = $1`,
      [req.params.id]
    );

    if (!entry) throw ApiError.notFound("Entry not found");
    if (entry.status === "SERVED") throw ApiError.badRequest("Already served");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Deduct 1 token for this labour
      const balance = await currentBalance(entry.accountId);
      if (balance < 1) throw ApiError.badRequest("No tokens remaining for this contractor");

      const newBalance = balance - 1;
      const txnRow = await client.query(
        `INSERT INTO contractor_token_transactions
           (account_id, txn_type, quantity, price_per_token, balance_after, note, performed_by_id)
         VALUES ($1, 'DEDUCT', -1, NULL, $2, $3, $4)
         RETURNING id`,
        [entry.accountId, newBalance, `Labour entry #${entry.entryNo} served`, req.user!.sub]
      );

      const txnId = txnRow.rows[0].id;

      const updated = await client.query(
        `UPDATE contractor_labour_entries
         SET status = 'SERVED', served_by_id = $2, served_at = now(), token_txn_id = $3
         WHERE id = $1
         RETURNING id, entry_no AS "entryNo", labour_name AS "labourName", status, served_at AS "servedAt"`,
        [entry.id, req.user!.sub, txnId]
      );

      await client.query("COMMIT");
      res.json({ entry: updated.rows[0], balance: newBalance });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// ---------------------------------------------------------------------------
// GET /api/labour/pending — canteen: all pending entries across all contractors
// ---------------------------------------------------------------------------
labourRouter.get(
  "/pending",
  requireRole(Role.CANTEEN, Role.ADMIN),
  asyncHandler(async (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
    const entries = await query<{
      id: string; accountId: string; accountName: string;
      entryDate: string; entryNo: number; labourName: string | null;
      status: string; createdAt: string;
    }>(
      pool,
      `SELECT
         e.id,
         e.account_id AS "accountId",
         ba.name AS "accountName",
         e.entry_date AS "entryDate",
         e.entry_no AS "entryNo",
         e.labour_name AS "labourName",
         e.status,
         e.created_at AS "createdAt"
       FROM contractor_labour_entries e
       JOIN billing_accounts ba ON ba.id = e.account_id
       WHERE e.entry_date = $1
       ORDER BY ba.name, e.entry_no ASC`,
      [date]
    );
    res.json(entries);
  })
);
