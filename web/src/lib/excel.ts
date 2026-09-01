import * as XLSX from "xlsx";

/**
 * Downloads an array of flat objects as an .xlsx file. Keys become column
 * headers. Optionally pass a column map to rename/reorder headers.
 */
export function exportToExcel(
  filename: string,
  rows: Record<string, unknown>[],
  columns?: { key: string; header: string }[]
) {
  const data = columns
    ? rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, r[c.key] ?? ""])))
    : rows;

  const sheet = XLSX.utils.json_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(book, `${filename}-${stamp}.xlsx`);
}
