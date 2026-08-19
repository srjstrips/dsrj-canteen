import { Router } from "express";
import { z } from "zod";
import { pool, queryOne } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { comparePassword } from "../../utils/password";
import { signToken } from "../../utils/jwt";
import { validateBody } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";
import { Role } from "../../types/domain";

export const authRouter = Router();

interface UserRow {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: Role;
  active: boolean;
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { username, password } = req.body as z.infer<typeof loginSchema>;
    const user = await queryOne<UserRow>(pool, "SELECT * FROM users WHERE username = $1", [username.toLowerCase()]);
    if (!user || !user.active) throw ApiError.unauthorized("Invalid username or password");

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized("Invalid username or password");

    const token = signToken({ sub: user.id, role: user.role, name: user.name, username: user.username });
    res.json({
      token,
      user: { id: user.id, name: user.name, username: user.username, role: user.role },
    });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await queryOne<UserRow>(pool, "SELECT * FROM users WHERE id = $1", [req.user!.sub]);
    if (!user) throw ApiError.notFound("User not found");
    res.json({ id: user.id, name: user.name, username: user.username, role: user.role });
  })
);
