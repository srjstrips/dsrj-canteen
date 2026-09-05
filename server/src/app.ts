import "express-async-errors";
import path from "path";
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
import { managedRouter } from "./modules/managed/managed.routes";
import { resetRouter } from "./modules/admin/reset.routes";
import { importsRouter } from "./modules/imports/imports.routes";
import { tokensRouter } from "./modules/tokens/tokens.routes";
import { labourRouter } from "./modules/tokens/labour.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";

export function createApp() {
  const app = express();

  // Allow the web app (different origin in dev) to load uploaded images.
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json());
  if (env.nodeEnv !== "test") app.use(morgan("dev"));

  // Uploaded product images (served from server/uploads).
  app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

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
  app.use("/api/managed", managedRouter);
  app.use("/api/admin", resetRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/tokens", tokensRouter);
  app.use("/api/labour", labourRouter);
  app.use("/api/notifications", notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
