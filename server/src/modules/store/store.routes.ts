import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { getStoreLedger, getStoreStockSummary, issueStockToCanteen, recordStockInward } from "./store.service";

export const storeRouter = Router();
storeRouter.use(requireAuth);

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
    const inwards = await prisma.stockInward.findMany({
      where: {
        supplierId: supplierId || undefined,
        inwardDate: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
      },
      include: { items: { include: { product: { include: { unit: true } } } }, supplier: true, createdBy: { select: { id: true, name: true } } },
      orderBy: { inwardDate: "desc" },
    });
    res.json(inwards);
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
  "/stock-issue",
  asyncHandler(async (req, res) => {
    const { from, to } = req.query as Record<string, string | undefined>;
    const issues = await prisma.stockIssue.findMany({
      where: {
        issueDate: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
      },
      include: { items: { include: { product: { include: { unit: true } } } }, createdBy: { select: { id: true, name: true } } },
      orderBy: { issueDate: "desc" },
    });
    res.json(issues);
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
    const products = await prisma.product.findMany({
      where: { active: true },
      include: { storeStockBalance: true, unit: true, category: true },
    });
    const low = products.filter((p) => (p.storeStockBalance?.quantity.toNumber() ?? 0) <= p.minStockLevel.toNumber());
    res.json(low);
  })
);

storeRouter.get(
  "/dashboard",
  asyncHandler(async (_req, res) => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    const [balances, todaysInward, todaysIssue, products, recentInwards, recentIssues] = await Promise.all([
      prisma.storeStockBalance.aggregate({ _sum: { stockValue: true } }),
      prisma.stockInwardItem.aggregate({
        where: { stockInward: { inwardDate: { gte: startOfDay, lte: endOfDay } } },
        _sum: { totalValue: true, quantity: true },
      }),
      prisma.stockIssueItem.aggregate({
        where: { stockIssue: { issueDate: { gte: startOfDay, lte: endOfDay } } },
        _sum: { issueValue: true, quantity: true },
      }),
      prisma.product.findMany({ where: { active: true }, include: { storeStockBalance: true } }),
      prisma.stockInward.findMany({ take: 5, orderBy: { createdAt: "desc" }, include: { supplier: true, items: true } }),
      prisma.stockIssue.findMany({ take: 5, orderBy: { createdAt: "desc" }, include: { items: true } }),
    ]);

    const lowStockCount = products.filter((p) => (p.storeStockBalance?.quantity.toNumber() ?? 0) <= p.minStockLevel.toNumber()).length;

    res.json({
      totalStockValue: balances._sum.stockValue ?? 0,
      totalProducts: products.length,
      todaysInwardQty: todaysInward._sum.quantity ?? 0,
      todaysInwardValue: todaysInward._sum.totalValue ?? 0,
      todaysIssueQty: todaysIssue._sum.quantity ?? 0,
      todaysIssueValue: todaysIssue._sum.issueValue ?? 0,
      lowStockCount,
      recentInwards,
      recentIssues,
    });
  })
);
