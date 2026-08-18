import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { authRouter } from "./modules/auth/auth.routes";
import { usersRouter } from "./modules/users/users.routes";
import { categoriesRouter, unitsRouter, productsRouter, suppliersRouter } from "./modules/masters/masters.routes";
import { storeRouter } from "./modules/store/store.routes";
import { canteenRouter } from "./modules/canteen/canteen.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  if (env.nodeEnv !== "test") app.use(morgan("dev"));

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRouter);
  app.use("/api/admin/users", usersRouter);
  app.use("/api/masters/categories", categoriesRouter);
  app.use("/api/masters/units", unitsRouter);
  app.use("/api/masters/products", productsRouter);
  app.use("/api/masters/suppliers", suppliersRouter);
  app.use("/api/store", storeRouter);
  app.use("/api/canteen", canteenRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/dashboard", dashboardRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
