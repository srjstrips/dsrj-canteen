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

const itemSchema = z.object({
  expenseName: z.string().min(1, "Expense name is required"),
  qty: z.number().positive("Qty must be > 0"),
  rate: z.number().nonnegative("Rate cannot be negative"),
  gstPct: z.number().min(0).max(100).default(0),
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
      'rate', ei.rate,
      'gstPct', ei.gst_pct,
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
        const gstAmount = baseAmount * (item.gstPct / 100);
        const amount = Math.round((baseAmount + gstAmount) * 100) / 100;
        totalAmount += amount;

        await query(
          client,
          `INSERT INTO store_expense_items (expense_id, expense_name, qty, rate, gst_pct, amount)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [expenseId, item.expenseName, item.qty, item.rate, item.gstPct, amount]
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

// DELETE /store/expenses/:id
expensesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const expense = await queryOne(pool, "SELECT id FROM store_expenses WHERE id = $1", [req.params.id]);
    if (!expense) throw ApiError.notFound("Expense not found");
    await query(pool, "DELETE FROM store_expenses WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  })
);
