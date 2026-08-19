import { Router } from "express";
import multer from "multer";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { ApiError } from "../../utils/ApiError";
import { Role } from "../../types/domain";
import { buildMasterTemplate, getImporter, importMasterWorkbook } from "./mastersImport.service";

export const importsRouter = Router();
importsRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** ADMIN always passes; otherwise the caller's role must match the importer's. */
function assertRole(userRole: Role, needed: Role) {
  if (userRole !== Role.ADMIN && userRole !== needed) {
    throw ApiError.forbidden(`This import requires role: ${needed}`);
  }
}

importsRouter.get(
  "/:entity/template",
  asyncHandler(async (req, res) => {
    const config = getImporter(req.params.entity);
    assertRole(req.user!.role, config.role);
    const buffer = await buildMasterTemplate(req.params.entity);
    res.setHeader("Content-Type", XLSX_CONTENT_TYPE);
    res.setHeader("Content-Disposition", `attachment; filename=${config.templateName}`);
    res.send(buffer);
  })
);

importsRouter.post(
  "/:entity/import",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const config = getImporter(req.params.entity);
    assertRole(req.user!.role, config.role);
    if (!req.file) throw ApiError.badRequest("No file uploaded");

    const result = await importMasterWorkbook(req.params.entity, req.file.buffer, req.user!.sub);
    if (result.errors.length > 0) {
      return res.status(400).json({ error: "The uploaded file has errors", rowErrors: result.errors });
    }
    res.status(201).json({ importedRows: result.importedRows, skipped: result.skipped });
  })
);
