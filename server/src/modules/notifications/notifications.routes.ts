import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// POST /api/notifications/token — register FCM push token for current user
// ---------------------------------------------------------------------------
const tokenSchema = z.object({ token: z.string().min(10) });

notificationsRouter.post(
  "/token",
  validateBody(tokenSchema),
  asyncHandler(async (req, res) => {
    const { token } = req.body as z.infer<typeof tokenSchema>;
    const userId = req.user!.sub;

    await pool.query(
      `INSERT INTO fcm_tokens (user_id, token)
       VALUES ($1, $2)
       ON CONFLICT (token) DO UPDATE SET user_id = $1, updated_at = now()`,
      [userId, token]
    );

    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// GET /api/notifications — list notifications for current user
// ---------------------------------------------------------------------------
notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    const rows = await query<{
      id: string; type: string; title: string; body: string;
      data: Record<string, string> | null; read: boolean; createdAt: string;
    }>(
      pool,
      `SELECT id, type, title, body, data, read, created_at AS "createdAt"
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    res.json(rows);
  })
);

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// ---------------------------------------------------------------------------
notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    const row = await queryOne<{ count: string }>(
      pool,
      `SELECT COUNT(*) AS count FROM notifications WHERE user_id = $1 AND read = FALSE`,
      [req.user!.sub]
    );
    res.json({ count: Number(row?.count ?? 0) });
  })
);

// ---------------------------------------------------------------------------
// POST /api/notifications/:id/read — mark one as read
// ---------------------------------------------------------------------------
notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user!.sub]
    );
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all — mark all as read
// ---------------------------------------------------------------------------
notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE`,
      [req.user!.sub]
    );
    res.json({ ok: true });
  })
);
