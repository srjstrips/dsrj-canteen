import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { hashPassword } from "../../utils/password";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole(Role.ADMIN));

const userSelect = { id: true, name: true, email: true, role: true, active: true, createdAt: true, updatedAt: true };

usersRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ select: userSelect, orderBy: { createdAt: "desc" } });
    res.json(users);
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
});

usersRouter.post(
  "/",
  validateBody(createSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof createSchema>;
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { name: body.name, email: body.email.toLowerCase(), passwordHash, role: body.role },
      select: userSelect,
    });
    await writeAudit(prisma, { entity: "User", entityId: user.id, action: "CREATE", actorId: req.user!.sub, after: user });
    res.status(201).json(user);
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.nativeEnum(Role).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

usersRouter.patch(
  "/:id",
  validateBody(updateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof updateSchema>;
    const before = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
    if (!before) throw ApiError.notFound("User not found");

    const data: Record<string, unknown> = {
      name: body.name,
      role: body.role,
      active: body.active,
    };
    if (body.password) data.passwordHash = await hashPassword(body.password);

    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: userSelect });
    await writeAudit(prisma, { entity: "User", entityId: user.id, action: "UPDATE", actorId: req.user!.sub, before, after: user });
    res.json(user);
  })
);
