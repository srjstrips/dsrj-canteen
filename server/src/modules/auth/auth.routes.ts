import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import { asyncHandler } from "../../utils/asyncHandler";
import { comparePassword } from "../../utils/password";
import { signToken } from "../../utils/jwt";
import { validateBody } from "../../middleware/validate";
import { requireAuth } from "../../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.active) throw ApiError.unauthorized("Invalid email or password");

    const ok = await comparePassword(password, user.passwordHash);
    if (!ok) throw ApiError.unauthorized("Invalid email or password");

    const token = signToken({ sub: user.id, role: user.role, name: user.name, email: user.email });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user) throw ApiError.notFound("User not found");
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  })
);
