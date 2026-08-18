import { NextFunction, Request, Response } from "express";
import { AnyZodObject } from "zod";

export function validateBody(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.query = schema.parse(req.query) as unknown as Request["query"];
    next();
  };
}
