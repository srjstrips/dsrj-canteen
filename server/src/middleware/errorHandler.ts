import { NextFunction, Request, Response } from "express";
import { DatabaseError } from "pg";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: `No route: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ error: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Validation failed", details: err.flatten() });
  }
  if (err instanceof DatabaseError) {
    // https://www.postgresql.org/docs/current/errcodes-appendix.html
    if (err.code === "23505") {
      return res.status(409).json({ error: `Duplicate value for: ${err.constraint ?? "unique field"}` });
    }
    if (err.code === "23503") {
      return res.status(400).json({ error: "Referenced record does not exist" });
    }
    if (err.code === "23514") {
      return res.status(400).json({ error: "Value violates a database constraint" });
    }
  }
  // eslint-disable-next-line no-console
  console.error(err);
  const message = err instanceof Error ? err.message : "Internal server error";
  return res.status(500).json({ error: message });
}
