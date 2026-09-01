import toast from "react-hot-toast";
import { exportToExcel } from "../lib/excel";

interface ExcelButtonProps {
  filename: string;
  rows: Record<string, unknown>[] | undefined;
  columns?: { key: string; header: string }[];
  className?: string;
}

/** "Export Excel" button — downloads the given rows as an .xlsx file. */
export function ExcelButton({ filename, rows, columns, className }: ExcelButtonProps) {
  return (
    <button
      className={className ?? "btn-secondary !py-1.5 text-xs"}
      onClick={() => {
        if (!rows || rows.length === 0) return toast.error("Nothing to export");
        exportToExcel(filename, rows, columns);
      }}
    >
      ⬇ Export Excel
    </button>
  );
}
