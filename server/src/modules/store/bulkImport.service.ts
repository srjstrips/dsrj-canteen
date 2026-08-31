import ExcelJS from "exceljs";
import { pool, query } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";

interface TemplateProduct {
  id: string;
  name: string;
  unitSymbol: string;
  currentAvgRate: string | null;
}

async function activeProductsForTemplate(): Promise<TemplateProduct[]> {
  return query<TemplateProduct>(
    pool,
    `SELECT p.id, p.name, u.symbol AS "unitSymbol", b.avg_rate AS "currentAvgRate"
     FROM products p
     JOIN units u ON u.id = p.unit_id
     LEFT JOIN store_stock_balances b ON b.product_id = p.id
     WHERE p.active = TRUE
     ORDER BY p.name ASC`
  );
}

/**
 * Builds a Stock Inward bulk-upload template pre-filled with the full
 * Product Master (spec §3: never make users free-type a product name).
 * Users only fill in Quantity and Rate for the products they received.
 */
export async function buildInwardTemplate(): Promise<Buffer> {
  const products = await activeProductsForTemplate();
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Stock Inward");

  sheet.columns = [
    { header: "Product ID (do not edit)", key: "id", width: 38 },
    { header: "Product Name", key: "name", width: 28 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Quantity", key: "quantity", width: 14 },
    { header: "Rate (₹ per unit)", key: "rate", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn("id").protection = { locked: true };

  for (const p of products) {
    sheet.addRow({ id: p.id, name: p.name, unit: p.unitSymbol, quantity: null, rate: null });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Same idea for Stock Issue — quantity only, rate is always automatic. */
export async function buildIssueTemplate(): Promise<Buffer> {
  const products = await activeProductsForTemplate();
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Stock Issue");

  sheet.columns = [
    { header: "Product ID (do not edit)", key: "id", width: 38 },
    { header: "Product Name", key: "name", width: 28 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Current Avg Rate", key: "avgRate", width: 16 },
    { header: "Issue Quantity", key: "quantity", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn("id").protection = { locked: true };

  for (const p of products) {
    sheet.addRow({ id: p.id, name: p.name, unit: p.unitSymbol, avgRate: p.currentAvgRate ? Number(p.currentAvgRate) : 0, quantity: null });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

interface CanteenTemplateProduct {
  id: string;
  name: string;
  unitSymbol: string;
  canteenQty: string | null;
}

async function canteenProductsForTemplate(): Promise<CanteenTemplateProduct[]> {
  return query<CanteenTemplateProduct>(
    pool,
    `SELECT p.id, p.name, u.symbol AS "unitSymbol", b.quantity AS "canteenQty"
     FROM products p
     JOIN units u ON u.id = p.unit_id
     LEFT JOIN canteen_stock_balances b ON b.product_id = p.id
     WHERE p.active = TRUE
     ORDER BY p.name ASC`
  );
}

/** Stock Return template — pre-filled with each product's CURRENT canteen
 * balance so the store user can see how much is available to return, then
 * fill only the Return Quantity. */
export async function buildReturnTemplate(): Promise<Buffer> {
  const products = await canteenProductsForTemplate();
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Stock Return");

  sheet.columns = [
    { header: "Product ID (do not edit)", key: "id", width: 38 },
    { header: "Product Name", key: "name", width: 28 },
    { header: "Unit", key: "unit", width: 10 },
    { header: "Canteen Qty (available)", key: "canteenQty", width: 22 },
    { header: "Return Quantity", key: "quantity", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getColumn("id").protection = { locked: true };

  for (const p of products) {
    sheet.addRow({ id: p.id, name: p.name, unit: p.unitSymbol, canteenQty: p.canteenQty ? Number(p.canteenQty) : 0, quantity: null });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export interface ParsedReturnRow {
  row: number;
  productId: string;
  quantity: number;
}

export async function parseReturnWorkbook(buffer: Buffer): Promise<{ rows: ParsedReturnRow[]; errors: RowError[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw ApiError.badRequest("The uploaded file has no worksheet");
  const validIds = new Set((await canteenProductsForTemplate()).map((p) => p.id));

  const rows: ParsedReturnRow[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const productId = cellText(row.getCell(1).value);
    const quantity = cellNumber(row.getCell(5).value);

    if (!productId && quantity === null) return;
    if (!productId) return errors.push({ row: rowNumber, message: "Missing Product ID — do not delete or reorder that column" });
    if (!validIds.has(productId)) return errors.push({ row: rowNumber, message: "Unknown or inactive Product ID" });
    if (quantity === null) return;
    if (quantity <= 0) return errors.push({ row: rowNumber, message: "Return Quantity must be greater than 0" });

    rows.push({ row: rowNumber, productId, quantity });
  });

  return { rows, errors };
}

export interface ParsedInwardRow {
  row: number;
  productId: string;
  quantity: number;
  rate: number;
}

export interface ParsedIssueRow {
  row: number;
  productId: string;
  quantity: number;
}

export interface RowError {
  row: number;
  message: string;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "");
  if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "");
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  const text = cellText(value);
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

async function loadWorkbookRows(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw ApiError.badRequest("The uploaded file has no worksheet");

  const validIds = new Set((await activeProductsForTemplate()).map((p) => p.id));
  return { sheet, validIds };
}

/** Parses a filled-in Stock Inward template. Rows with a blank Quantity are
 * skipped (the user left that product out of this delivery); every other
 * row is fully validated so the caller gets one combined error report
 * instead of a partial, confusing import. */
export async function parseInwardWorkbook(buffer: Buffer): Promise<{ rows: ParsedInwardRow[]; errors: RowError[] }> {
  const { sheet, validIds } = await loadWorkbookRows(buffer);
  const rows: ParsedInwardRow[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const productId = cellText(row.getCell(1).value);
    const quantity = cellNumber(row.getCell(4).value);
    const rate = cellNumber(row.getCell(5).value);

    if (!productId && quantity === null && rate === null) return; // fully blank row
    if (!productId) return errors.push({ row: rowNumber, message: "Missing Product ID — do not delete or reorder that column" });
    if (!validIds.has(productId)) return errors.push({ row: rowNumber, message: "Unknown or inactive Product ID" });
    if (quantity === null) return; // no quantity entered for this product — skip it
    if (quantity <= 0) return errors.push({ row: rowNumber, message: "Quantity must be greater than 0" });
    if (rate === null || rate < 0) return errors.push({ row: rowNumber, message: "Rate is required and cannot be negative" });

    rows.push({ row: rowNumber, productId, quantity, rate });
  });

  return { rows, errors };
}

export async function parseIssueWorkbook(buffer: Buffer): Promise<{ rows: ParsedIssueRow[]; errors: RowError[] }> {
  const { sheet, validIds } = await loadWorkbookRows(buffer);
  const rows: ParsedIssueRow[] = [];
  const errors: RowError[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const productId = cellText(row.getCell(1).value);
    const quantity = cellNumber(row.getCell(5).value);

    if (!productId && quantity === null) return;
    if (!productId) return errors.push({ row: rowNumber, message: "Missing Product ID — do not delete or reorder that column" });
    if (!validIds.has(productId)) return errors.push({ row: rowNumber, message: "Unknown or inactive Product ID" });
    if (quantity === null) return;
    if (quantity <= 0) return errors.push({ row: rowNumber, message: "Quantity must be greater than 0" });

    rows.push({ row: rowNumber, productId, quantity });
  });

  return { rows, errors };
}
