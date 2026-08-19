import { Request, Response, NextFunction } from "express";
import { Role } from "../types/domain";
import { ApiError } from "../utils/ApiError";
import { JwtPayload, verifyToken } from "../utils/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw ApiError.unauthorized("Missing or invalid Authorization header");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired token");
  }
  next();
}

/** ADMIN always passes; otherwise the caller's role must be in `roles`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw ApiError.unauthorized();
    if (req.user.role === Role.ADMIN || roles.includes(req.user.role)) {
      return next();
    }
    throw ApiError.forbidden(`This action requires role: ${roles.join(" or ")}`);
  };
}
