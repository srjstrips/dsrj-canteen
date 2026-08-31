import { Router } from "express";
import { z } from "zod";
import { pool, query, queryOne } from "../../db/pool";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { hashPassword } from "../../utils/password";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";
import { Role } from "../../types/domain";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole(Role.ADMIN));

const USER_COLUMNS = "id, name, username, role, active, can_edit_old, created_at, updated_at";

interface UserRow {
  id: string;
  name: string;
  username: string;
  role: Role;
  active: boolean;
  canEditOld: boolean;
  createdAt: string;
  updatedAt: string;
}

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await query<UserRow>(pool, `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at DESC`);
    res.json(users);
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  username: z
    .string()
    .min(3)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, dots, underscores and hyphens"),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  canEditOld: z.boolean().optional(),
});

usersRouter.post(
  "/",
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const passwordHash = await hashPassword(body.password);
    const user = await queryOne<UserRow>(
      pool,
      `INSERT INTO users (name, username, password_hash, role, can_edit_old) VALUES ($1, $2, $3, $4, COALESCE($5, FALSE)) RETURNING ${USER_COLUMNS}`,
      [body.name, body.username.toLowerCase(), passwordHash, body.role, body.canEditOld ?? null]
    );
    await writeAudit(pool, { entity: "User", entityId: user!.id, action: "CREATE", actorId: req.user!.sub, after: user });
    res.status(201).json(user);
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  canEditOld: z.boolean().optional(),
});

usersRouter.patch(
  "/:id",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateSchema>;
    const before = await queryOne<UserRow>(pool, `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [req.params.id]);
    if (!before) throw ApiError.notFound("User not found");

    const passwordHash = body.password ? await hashPassword(body.password) : undefined;

    const user = await queryOne<UserRow>(
      pool,
      `UPDATE users SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         active = COALESCE($4, active),
         password_hash = COALESCE($5, password_hash),
         can_edit_old = COALESCE($6, can_edit_old),
         updated_at = now()
       WHERE id = $1
       RETURNING ${USER_COLUMNS}`,
      [req.params.id, body.name ?? null, body.role ?? null, body.active ?? null, passwordHash ?? null, body.canEditOld ?? null]
    );
    await writeAudit(pool, { entity: "User", entityId: user!.id, action: "UPDATE", actorId: req.user!.sub, before, after: user });
    res.json(user);
  })
);
