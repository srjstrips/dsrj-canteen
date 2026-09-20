import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne, withTransaction } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { Role } from "../../types/domain";
import { generateDocNo } from "../../utils/docNumber";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);
expensesRouter.use(requireRole(Role.STORE, Role.ADMIN));

const UNITS = ["Pcs", "Kg", "Litre", "Gram", "ml", "Metre"] as const;

const itemSchema = z.object({
  expenseName: z.string().min(1, "Expense name is required"),
  qty: z.number().positive("Qty must be > 0"),
  unit: z.enum(UNITS).default("Pcs"),
  rate: z.number().nonnegative("Rate cannot be negative"),
  gstMode: z.enum(["pct", "amount"]).default("pct"),
  gstPct: z.number().min(0).max(100).default(0),
  gstAmount: z.number().nonnegative().default(0),
});

const expenseSchema = z.object({
  expenseDate: z.coerce.date().optional(),
  invoiceNo: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(itemSchema).min(1, "At least one item is required"),
});

const EXPENSE_SELECT = `
  SELECT e.*,
    jsonb_build_object('id', u.id, 'name', u.name) AS "createdBy",
    COALESCE(items.items, '[]'::jsonb) AS items
  FROM store_expenses e
  JOIN users u ON u.id = e.created_by_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', ei.id,
      'expenseName', ei.expense_name,
      'qty', ei.qty,
      'unit', ei.unit,
      'rate', ei.rate,
      'gstPct', ei.gst_pct,
      'gstAmount', ei.gst_amount,
      'amount', ei.amount
    ) ORDER BY ei.created_at) AS items
    FROM store_expense_items ei
    WHERE ei.expense_id = e.id
  ) items ON TRUE
`;

// POST /store/expenses — create a new expense entry
expensesRouter.post(
  "/",
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof expenseSchema>;
    const expenseDate = body.expenseDate ?? new Date();
    const expenseNo = generateDocNo("EXP", expenseDate);

    const result = await withTransaction(async (client) => {
      const expense = await queryOne<{ id: string }>(
        client,
        `INSERT INTO store_expenses (expense_no, expense_date, invoice_no, notes, created_by_id, total_amount)
         VALUES ($1, $2, $3, $4, $5, 0) RETURNING id`,
        [expenseNo, expenseDate, body.invoiceNo ?? null, body.notes ?? null, req.user!.sub]
      );
      const expenseId = expense!.id;

      let totalAmount = 0;
      for (const item of body.items) {
        const baseAmount = item.qty * item.rate;
        const resolvedGstAmount = item.gstMode === "amount"
          ? item.gstAmount
          : Math.round(baseAmount * (item.gstPct / 100) * 100) / 100;
        const resolvedGstPct = item.gstMode === "amount"
          ? (baseAmount > 0 ? Math.round((item.gstAmount / baseAmount) * 10000) / 100 : 0)
          : item.gstPct;
        const amount = Math.round((baseAmount + resolvedGstAmount) * 100) / 100;
        totalAmount += amount;

        await query(
          client,
          `INSERT INTO store_expense_items (expense_id, expense_name, qty, unit, rate, gst_pct, gst_amount, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [expenseId, item.expenseName, item.qty, item.unit ?? "Pcs", item.rate, resolvedGstPct, resolvedGstAmount, amount]
        );
      }

      await query(client, "UPDATE store_expenses SET total_amount = $2 WHERE id = $1", [expenseId, totalAmount]);
      return queryOne(client, `${EXPENSE_SELECT} WHERE e.id = $1`, [expenseId]);
    });

    res.status(201).json(result);
  })
);

// GET /store/expenses — list with optional date/month filter
expensesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { from, to, month } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (month) {
      // month = "YYYY-MM"
      params.push(`${month}-01`);
      conditions.push(`e.expense_date >= $${params.length}::date`);
      params.push(`${month}-01`);
      conditions.push(`e.expense_date < ($${params.length}::date + INTERVAL '1 month')`);
    } else {
      if (from) { params.push(from); conditions.push(`e.expense_date >= $${params.length}`); }
      if (to)   { params.push(to);   conditions.push(`e.expense_date <= $${params.length}`); }
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await query(pool, `${EXPENSE_SELECT} ${where} ORDER BY e.expense_date DESC, e.created_at DESC`, params);
    res.json(rows);
  })
);

// GET /store/expenses/summary — monthly totals for the last 12 months
expensesRouter.get(
  "/summary",
  asyncHandler(async (_req, res) => {
    const rows = await query(
      pool,
      `SELECT TO_CHAR(expense_date, 'YYYY-MM') AS month,
              COUNT(*)::int AS entries,
              SUM(total_amount) AS total
       FROM store_expenses
       WHERE expense_date >= CURRENT_DATE - INTERVAL '12 months'
       GROUP BY 1
       ORDER BY 1 DESC`
    );
    res.json(rows);
  })
);

function assertNotLocked(createdAt: string, role: string) {
  if (role === Role.ADMIN) return;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  if (ageMs > 48 * 60 * 60 * 1000) {
    throw ApiError.badRequest("This entry is older than 48 hours and can no longer be edited or deleted. Contact Admin.");
  }
}

// PATCH /store/expenses/:id — edit header + replace all items
expensesRouter.patch(
  "/:id",
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof expenseSchema>;
    const expense = await queryOne<{ id: string; createdAt: string }>(pool, `SELECT id, created_at AS "createdAt" FROM store_expenses WHERE id = $1`, [req.params.id]);
    if (!expense) throw ApiError.notFound("Expense not found");
    assertNotLocked(expense.createdAt, req.user!.role);

    const result = await withTransaction(async (client) => {
      await query(
        client,
        `UPDATE store_expenses SET expense_date = $2, invoice_no = $3, notes = $4, total_amount = 0 WHERE id = $1`,
        [req.params.id, body.expenseDate ?? new Date(), body.invoiceNo ?? null, body.notes ?? null]
      );
      await query(client, "DELETE FROM store_expense_items WHERE expense_id = $1", [req.params.id]);

      let totalAmount = 0;
      for (const item of body.items) {
        const baseAmount = item.qty * item.rate;
        const resolvedGstAmount = item.gstMode === "amount"
          ? item.gstAmount
          : Math.round(baseAmount * (item.gstPct / 100) * 100) / 100;
        const resolvedGstPct = item.gstMode === "amount"
          ? (baseAmount > 0 ? Math.round((item.gstAmount / baseAmount) * 10000) / 100 : 0)
          : item.gstPct;
        const amount = Math.round((baseAmount + resolvedGstAmount) * 100) / 100;
        totalAmount += amount;
        await query(
          client,
          `INSERT INTO store_expense_items (expense_id, expense_name, qty, unit, rate, gst_pct, gst_amount, amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.params.id, item.expenseName, item.qty, item.unit ?? "Pcs", item.rate, resolvedGstPct, resolvedGstAmount, amount]
        );
      }
      await query(client, "UPDATE store_expenses SET total_amount = $2 WHERE id = $1", [req.params.id, totalAmount]);
      return queryOne(client, `${EXPENSE_SELECT} WHERE e.id = $1`, [req.params.id]);
    });
    res.json(result);
  })
);

// DELETE /store/expenses/:id — single delete
expensesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const expense = await queryOne<{ id: string; createdAt: string }>(pool, `SELECT id, created_at AS "createdAt" FROM store_expenses WHERE id = $1`, [req.params.id]);
    if (!expense) throw ApiError.notFound("Expense not found");
    assertNotLocked(expense.createdAt, req.user!.role);
    await query(pool, "DELETE FROM store_expenses WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  })
);

// DELETE /store/expenses — bulk delete (ids[] in body) or all (ids: "all")
expensesRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids: string[] | "all" };
    const isAdmin = req.user!.role === Role.ADMIN;
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    if (ids === "all") {
      const whereClause = isAdmin ? "" : `WHERE created_at >= $1`;
      const params = isAdmin ? [] : [cutoff];
      await query(pool, `DELETE FROM store_expenses ${whereClause}`, params);
      return res.json({ success: true, deleted: "all" });
    }
    if (!Array.isArray(ids) || ids.length === 0) throw ApiError.badRequest("ids must be a non-empty array or 'all'");

    // For STORE role, verify all selected entries are within 48h
    if (!isAdmin) {
      const locked = await query<{ id: string }>(
        pool,
        `SELECT id FROM store_expenses WHERE id = ANY($1::uuid[]) AND created_at < $2`,
        [ids, cutoff]
      );
      if (locked.length > 0) throw ApiError.badRequest(`${locked.length} entry(s) are older than 48 hours. Contact Admin to delete them.`);
    }

    await query(pool, `DELETE FROM store_expenses WHERE id = ANY($1::uuid[])`, [ids]);
    res.json({ success: true, deleted: ids.length });
  })
);
