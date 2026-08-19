import ExcelJS from "exceljs";
import { PoolClient } from "pg";
import { pool, query, withTransaction } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { writeAudit } from "../../utils/audit";
import { Role } from "../../types/domain";

export interface RowError {
  row: number;
  message: string;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "").trim();
  if (typeof value === "object" && "result" in value) return String((value as { result: unknown }).result ?? "").trim();
  return String(value).trim();
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  const text = cellText(value);
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

interface ColumnDef {
  header: string;
  width: number;
}

interface ImporterConfig {
  /** Which role (besides ADMIN) may import this entity. */
  role: Role;
  entity: string;
  templateName: string;
  columns: ColumnDef[];
  /** Optional extra reference sheet (e.g. valid category/unit names). */
  buildReference?: () => Promise<{ title: string; header: string[]; rows: string[][] }>;
  /** Validates one row's cells → an insert record, or throws a message string. */
  parseRow: (cells: string[], ctx: ImportContext) => Record<string, unknown>;
  /** Inserts one parsed record. Returns the new id (or null if skipped as duplicate). */
  insert: (client: PoolClient, record: Record<string, unknown>) => Promise<string | null>;
}

interface ImportContext {
  categoryByName: Map<string, string>;
  unitByName: Map<string, string>;
}

async function loadContext(): Promise<ImportContext> {
  const categories = await query<{ id: string; name: string }>(pool, "SELECT id, name FROM categories");
  const units = await query<{ id: string; name: string; symbol: string }>(pool, "SELECT id, name, symbol FROM units");
  const categoryByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const unitByName = new Map<string, string>();
  for (const u of units) {
    unitByName.set(u.name.toLowerCase(), u.id);
    unitByName.set(u.symbol.toLowerCase(), u.id);
  }
  return { categoryByName, unitByName };
}

const IMPORTERS: Record<string, ImporterConfig> = {
  suppliers: {
    role: Role.STORE,
    entity: "Supplier",
    templateName: "suppliers-template.xlsx",
    columns: [
      { header: "Name *", width: 28 },
      { header: "Contact Person", width: 22 },
      { header: "Mobile", width: 16 },
      { header: "Address", width: 30 },
      { header: "GST Number", width: 20 },
      { header: "Payment Terms", width: 18 },
    ],
    parseRow: (c) => {
      const name = c[0];
      if (!name) throw "Name is required";
      return { name, contactPerson: c[1] || null, mobile: c[2] || null, address: c[3] || null, gstNumber: c[4] || null, paymentTerms: c[5] || null };
    },
    insert: async (client, r) => {
      const row = await client.query(
        `INSERT INTO suppliers (name, contact_person, mobile, address, gst_number, payment_terms)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [r.name, r.contactPerson, r.mobile, r.address, r.gstNumber, r.paymentTerms]
      );
      return row.rows[0].id as string;
    },
  },

  categories: {
    role: Role.ADMIN,
    entity: "Category",
    templateName: "categories-template.xlsx",
    columns: [{ header: "Name *", width: 28 }],
    parseRow: (c) => {
      if (!c[0]) throw "Name is required";
      return { name: c[0] };
    },
    insert: async (client, r) => {
      const row = await client.query(
        "INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id",
        [r.name]
      );
      return row.rows[0]?.id ?? null;
    },
  },

  units: {
    role: Role.ADMIN,
    entity: "Unit",
    templateName: "units-template.xlsx",
    columns: [
      { header: "Name *", width: 22 },
      { header: "Symbol *", width: 14 },
    ],
    parseRow: (c) => {
      if (!c[0]) throw "Name is required";
      if (!c[1]) throw "Symbol is required";
      return { name: c[0], symbol: c[1] };
    },
    insert: async (client, r) => {
      const row = await client.query(
        "INSERT INTO units (name, symbol) VALUES ($1, $2) ON CONFLICT (symbol) DO NOTHING RETURNING id",
        [r.name, r.symbol]
      );
      return row.rows[0]?.id ?? null;
    },
  },

  products: {
    role: Role.STORE,
    entity: "Product",
    templateName: "products-template.xlsx",
    columns: [
      { header: "Name *", width: 28 },
      { header: "Category *", width: 20 },
      { header: "Unit *", width: 14 },
      { header: "Sell Price", width: 14 },
      { header: "Min Stock Level", width: 16 },
      { header: "Reorder Level", width: 16 },
      { header: "Track Canteen Stock (Y/N)", width: 24 },
    ],
    buildReference: async () => {
      const cats = await query<{ name: string }>(pool, "SELECT name FROM categories WHERE active = TRUE ORDER BY name");
      const units = await query<{ name: string; symbol: string }>(pool, "SELECT name, symbol FROM units WHERE active = TRUE ORDER BY name");
      const rows: string[][] = [];
      const max = Math.max(cats.length, units.length);
      for (let i = 0; i < max; i++) rows.push([cats[i]?.name ?? "", units[i] ? `${units[i].name} (${units[i].symbol})` : ""]);
      return { title: "Valid Categories & Units", header: ["Category", "Unit (name or symbol)"], rows };
    },
    parseRow: (c, ctx) => {
      const name = c[0];
      if (!name) throw "Name is required";
      const categoryId = ctx.categoryByName.get((c[1] || "").toLowerCase());
      if (!categoryId) throw `Unknown category "${c[1]}" — see the Reference sheet`;
      const unitId = ctx.unitByName.get((c[2] || "").toLowerCase());
      if (!unitId) throw `Unknown unit "${c[2]}" — see the Reference sheet`;
      const sellPrice = c[3] === "" ? null : Number(c[3]);
      if (sellPrice !== null && (!Number.isFinite(sellPrice) || sellPrice < 0)) throw "Sell Price must be a non-negative number";
      const minStock = c[4] === "" ? 0 : Number(c[4]);
      const reorder = c[5] === "" ? 0 : Number(c[5]);
      if (!Number.isFinite(minStock) || minStock < 0) throw "Min Stock Level must be a non-negative number";
      if (!Number.isFinite(reorder) || reorder < 0) throw "Reorder Level must be a non-negative number";
      const track = (c[6] || "Y").trim().toUpperCase();
      const trackCanteenStock = track !== "N" && track !== "NO";
      return { name, categoryId, unitId, sellPrice, minStock, reorder, trackCanteenStock };
    },
    insert: async (client, r) => {
      const row = await client.query(
        `INSERT INTO products (name, category_id, unit_id, sell_price, min_stock_level, reorder_level, track_canteen_stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name, unit_id) DO NOTHING RETURNING id`,
        [r.name, r.categoryId, r.unitId, r.sellPrice, r.minStock, r.reorder, r.trackCanteenStock]
      );
      return row.rows[0]?.id ?? null;
    },
  },

  "billing-accounts": {
    role: Role.ADMIN,
    entity: "BillingAccount",
    templateName: "billing-accounts-template.xlsx",
    columns: [
      { header: "Name *", width: 28 },
      { header: "Type (COMPANY / CONTRACTOR) *", width: 30 },
      { header: "Contact Person", width: 22 },
      { header: "Mobile", width: 16 },
    ],
    parseRow: (c) => {
      const name = c[0];
      if (!name) throw "Name is required";
      const type = (c[1] || "").toUpperCase();
      if (type !== "COMPANY" && type !== "CONTRACTOR") throw 'Type must be "COMPANY" or "CONTRACTOR"';
      return { name, type, contactPerson: c[2] || null, mobile: c[3] || null };
    },
    insert: async (client, r) => {
      const row = await client.query(
        `INSERT INTO billing_accounts (name, type, contact_person, mobile)
         VALUES ($1, $2, $3, $4) ON CONFLICT (name, type) DO NOTHING RETURNING id`,
        [r.name, r.type, r.contactPerson, r.mobile]
      );
      return row.rows[0]?.id ?? null;
    },
  },
};

export function getImporter(entity: string): ImporterConfig {
  const config = IMPORTERS[entity];
  if (!config) throw ApiError.notFound(`Unknown import type: ${entity}`);
  return config;
}

export async function buildMasterTemplate(entity: string): Promise<Buffer> {
  const config = getImporter(entity);
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(config.entity);
  sheet.columns = config.columns.map((c) => ({ header: c.header, width: c.width }));
  sheet.getRow(1).font = { bold: true };

  if (config.buildReference) {
    const ref = await config.buildReference();
    const refSheet = wb.addWorksheet(ref.title);
    refSheet.addRow(ref.header).font = { bold: true };
    ref.rows.forEach((r) => refSheet.addRow(r));
    refSheet.columns.forEach((col) => (col.width = 26));
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function importMasterWorkbook(entity: string, buffer: Buffer, actorId: string) {
  const config = getImporter(entity);
  const ctx = await loadContext();

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw ApiError.badRequest("The uploaded file has no worksheet");

  const parsed: { row: number; record: Record<string, unknown> }[] = [];
  const errors: RowError[] = [];
  const colCount = config.columns.length;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const cells: string[] = [];
    for (let i = 1; i <= colCount; i++) cells.push(cellText(row.getCell(i).value));
    if (cells.every((c) => c === "")) return; // blank row

    try {
      parsed.push({ row: rowNumber, record: config.parseRow(cells, ctx) });
    } catch (msg) {
      errors.push({ row: rowNumber, message: typeof msg === "string" ? msg : "Invalid row" });
    }
  });

  if (errors.length > 0) return { importedRows: 0, skipped: 0, errors };
  if (parsed.length === 0) throw ApiError.badRequest("No data rows were found in the uploaded file");

  const inserted = await withTransaction(async (client) => {
    let count = 0;
    for (const p of parsed) {
      const id = await config.insert(client, p.record);
      if (id) {
        count++;
        await writeAudit(client, { entity: config.entity, entityId: id, action: "CREATE", actorId, after: p.record });
      }
    }
    return count;
  });

  return { importedRows: inserted, skipped: parsed.length - inserted, errors: [] as RowError[] };
}

// Re-exported so the route can pull `cellNumber` if ever needed elsewhere.
export { cellNumber };
