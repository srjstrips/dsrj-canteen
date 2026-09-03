import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { ApiError } from "../../utils/ApiError";
import { D } from "../../utils/money";
import { Role } from "../../types/domain";
import {
  INWARD_SELECT,
  ISSUE_SELECT,
  RETURN_SELECT,
  getStoreLedger,
  getStoreStockSummary,
  issueStockToCanteen,
  recordReturnFromCanteen,
  recordStockInward,
} from "./store.service";
import { buildInwardTemplate, buildIssueTemplate, buildReturnTemplate, parseInwardWorkbook, parseIssueWorkbook, parseReturnWorkbook } from "./bulkImport.service";

export const storeRouter = Router();
storeRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const lineItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive("Quantity must be greater than 0"),
  rate: z.number().nonnegative("Rate cannot be negative"),
});

const inwardSchema = z.object({
  supplierId: z.string().uuid({ message: "Supplier is required" }),
  invoiceNumber: z.string().optional(),
  inwardDate: z.coerce.date().optional(),
  items: z.array(lineItemSchema).min(1),
});

storeRouter.post(
  "/stock-inward",
  requireRole(Role.STORE),
  validateBody(inwardSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof inwardSchema>;
    const result = await recordStockInward({ ...body, createdById: req.user!.sub });
    res.status(201).json(result);
  })
);

storeRouter.get(
  "/stock-inward",
  asyncHandler(async (req, res) => {
    const { from, to, supplierId } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (supplierId) {
      params.push(supplierId);
      conditions.push(`si.supplier_id = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`si.inward_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`si.inward_date <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const inwards = await query(pool, `${INWARD_SELECT} ${where} ORDER BY si.inward_date DESC`, params);
    res.json(inwards);
  })
);

storeRouter.get(
  "/stock-inward/template",
  requireRole(Role.STORE),
  asyncHandler(async (_req, res) => {
    const buffer = await buildInwardTemplate();
    res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", "attachment; filename=stock-inward-template.xlsx");
    res.send(buffer);
  })
);

const importInwardSchema = z.object({
  supplierId: z.string().uuid({ message: "Supplier is required" }),
  invoiceNumber: z.string().optional(),
  inwardDate: z.coerce.date().optional(),
});

storeRouter.post(
  "/stock-inward/import",
  requireRole(Role.STORE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("No file uploaded");
    const body = importInwardSchema.parse({
      supplierId: req.body.supplierId,
      invoiceNumber: req.body.invoiceNumber || undefined,
      inwardDate: req.body.inwardDate || undefined,
    });

    const { rows, errors } = await parseInwardWorkbook(req.file.buffer);
    if (errors.length > 0) return res.status(400).json({ error: "The uploaded file has errors", rowErrors: errors });
    if (rows.length === 0) throw ApiError.badRequest("No rows with a quantity were found in the uploaded file");

    const result = await recordStockInward({
      supplierId: body.supplierId,
      invoiceNumber: body.invoiceNumber,
      inwardDate: body.inwardDate,
      items: rows.map((r) => ({ productId: r.productId, quantity: r.quantity, rate: r.rate })),
      createdById: req.user!.sub,
    });
    res.status(201).json({ importedRows: rows.length, inward: result });
  })
);

const issueSchema = z.object({
  issueDate: z.coerce.date().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().positive("Quantity must be greater than 0") })).min(1),
});

storeRouter.post(
  "/stock-issue",
  requireRole(Role.STORE),
  validateBody(issueSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof issueSchema>;
    const result = await issueStockToCanteen({ ...body, createdById: req.user!.sub });
    res.status(201).json(result);
  })
);

storeRouter.get(
  "/stock-issue/template",
  requireRole(Role.STORE),
  asyncHandler(async (_req, res) => {
    const buffer = await buildIssueTemplate();
    res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", "attachment; filename=stock-issue-template.xlsx");
    res.send(buffer);
  })
);

const importIssueSchema = z.object({ issueDate: z.coerce.date().optional() });

storeRouter.post(
  "/stock-issue/import",
  requireRole(Role.STORE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("No file uploaded");
    const body = importIssueSchema.parse({ issueDate: req.body.issueDate || undefined });

    const { rows, errors } = await parseIssueWorkbook(req.file.buffer);
    if (errors.length > 0) return res.status(400).json({ error: "The uploaded file has errors", rowErrors: errors });
    if (rows.length === 0) throw ApiError.badRequest("No rows with a quantity were found in the uploaded file");

    const result = await issueStockToCanteen({
      issueDate: body.issueDate,
      items: rows.map((r) => ({ productId: r.productId, quantity: r.quantity })),
      createdById: req.user!.sub,
    });
    res.status(201).json({ importedRows: rows.length, issue: result });
  })
);

storeRouter.get(
  "/stock-issue",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      conditions.push(`si.issue_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`si.issue_date <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const issues = await query(pool, `${ISSUE_SELECT} ${where} ORDER BY si.issue_date DESC`, params);
    res.json(issues);
  })
);

// ---------------------------------------------------------------------------
// Stock Return (Canteen -> Store) — reverse of Stock Issue
// ---------------------------------------------------------------------------

const returnSchema = z.object({
  returnDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().positive("Quantity must be greater than 0") })).min(1),
});

storeRouter.post(
  "/stock-return",
  requireRole(Role.STORE),
  validateBody(returnSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof returnSchema>;
    const result = await recordReturnFromCanteen({ ...body, createdById: req.user!.sub });
    res.status(201).json(result);
  })
);

storeRouter.get(
  "/stock-return/template",
  requireRole(Role.STORE),
  asyncHandler(async (_req, res) => {
    const buffer = await buildReturnTemplate();
    res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", "attachment; filename=stock-return-template.xlsx");
    res.send(buffer);
  })
);

const importReturnSchema = z.object({ returnDate: z.coerce.date().optional() });

storeRouter.post(
  "/stock-return/import",
  requireRole(Role.STORE),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.badRequest("No file uploaded");
    const body = importReturnSchema.parse({ returnDate: req.body.returnDate || undefined });

    const { rows, errors } = await parseReturnWorkbook(req.file.buffer);
    if (errors.length > 0) return res.status(400).json({ error: "The uploaded file has errors", rowErrors: errors });
    if (rows.length === 0) throw ApiError.badRequest("No rows with a quantity were found in the uploaded file");

    const result = await recordReturnFromCanteen({
      returnDate: body.returnDate,
      items: rows.map((r) => ({ productId: r.productId, quantity: r.quantity })),
      createdById: req.user!.sub,
    });
    res.status(201).json({ importedRows: rows.length, return: result });
  })
);

storeRouter.get(
  "/stock-return",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (from) {
      params.push(from);
      conditions.push(`sr.return_date >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`sr.return_date <= $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const returns = await query(pool, `${RETURN_SELECT} ${where} ORDER BY sr.return_date DESC`, params);
    res.json(returns);
  })
);

storeRouter.get(
  "/stock",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const today = new Date();
    const rangeFrom = from ? new Date(from) : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const rangeTo = to ? new Date(to) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    res.json(await getStoreStockSummary(rangeFrom, rangeTo));
  })
);

storeRouter.get(
  "/ledger/:productId",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    res.json(await getStoreLedger(req.params.productId, from ? new Date(from) : undefined, to ? new Date(to) : undefined));
  })
);

storeRouter.get(
  "/low-stock",
  asyncHandler(async (_req, res) => {
    const rows = await query<{ quantity: string | null; minStockLevel: string }>(
      pool,
      `SELECT p.*, jsonb_build_object('id', c.id, 'name', c.name) AS category, jsonb_build_object('id', u.id, 'name', u.name, 'symbol', u.symbol) AS unit,
          b.quantity, p.min_stock_level AS "minStockLevel"
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN units u ON u.id = p.unit_id
       LEFT JOIN store_stock_balances b ON b.product_id = p.id
       WHERE p.active = TRUE AND c.is_food = FALSE`
    );
    const low = rows.filter((p) => D(p.quantity ?? 0).lte(D(p.minStockLevel)));
    res.json(low);
  })
);

storeRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const [stockValueRow, todaysInwardRow, todaysIssueRow, lowStockRow, productCountRow, recentInwards, recentIssues] = await Promise.all([
      queryOne<{ total: string | null }>(pool, "SELECT SUM(stock_value) AS total FROM store_stock_balances"),
      queryOne<{ qty: string | null; value: string | null }>(
        pool,
        `SELECT SUM(sii.quantity) AS qty, SUM(sii.total_value) AS value
         FROM stock_inward_items sii JOIN stock_inwards si ON si.id = sii.stock_inward_id
         WHERE si.inward_date >= $1 AND si.inward_date <= $2`,
        [startOfDay, endOfDay]
      ),
      queryOne<{ qty: string | null; value: string | null }>(
        pool,
        `SELECT SUM(sii.quantity) AS qty, SUM(sii.issue_value) AS value
         FROM stock_issue_items sii JOIN stock_issues si ON si.id = sii.stock_issue_id
         WHERE si.issue_date >= $1 AND si.issue_date <= $2`,
        [startOfDay, endOfDay]
      ),
      queryOne<{ count: string }>(
        pool,
        `SELECT COUNT(*) AS count FROM products p LEFT JOIN store_stock_balances b ON b.product_id = p.id
         WHERE p.active = TRUE AND COALESCE(b.quantity, 0) <= p.min_stock_level`
      ),
      queryOne<{ count: string }>(pool, "SELECT COUNT(*) AS count FROM products WHERE active = TRUE"),
      query(pool, `${INWARD_SELECT} ORDER BY si.created_at DESC LIMIT 5`),
      query(pool, `${ISSUE_SELECT} ORDER BY si.created_at DESC LIMIT 5`),
    ]);

    res.json({
      totalStockValue: stockValueRow?.total ?? 0,
      totalProducts: Number(productCountRow?.count ?? 0),
      todaysInwardQty: todaysInwardRow?.qty ?? 0,
      todaysInwardValue: todaysInwardRow?.value ?? 0,
      todaysIssueQty: todaysIssueRow?.qty ?? 0,
      todaysIssueValue: todaysIssueRow?.value ?? 0,
      lowStockCount: Number(lowStockRow?.count ?? 0),
      recentInwards,
      recentIssues,
    });
  })
);
