import { useRef, useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { downloadFile } from "../lib/download";
import { apiErrorMessage } from "../api/client";

interface RowError {
  row: number;
  message: string;
}

interface BulkImportProps {
  templateUrl: string;
  templateFilename: string;
  /** Uploads the chosen file (as FormData with a "file" field) and returns how many rows were imported. */
  onImport: (file: File) => Promise<{ importedRows: number; skipped?: number }>;
  /** Helper text shown next to the buttons. */
  hint?: string;
  disabled?: boolean;
}

/** "Download Template" + "Upload filled sheet" pair used by Stock Inward and
 * Stock Issue bulk-entry (spec §3: pre-filled from Product Master, never
 * free-typed). Renders a per-row error report inline if the upload fails
 * validation, so one bad row doesn't just produce a generic toast. */
export function BulkImport({
  templateUrl,
  templateFilename,
  onImport,
  hint = "Fill in Quantity (and Rate) against the pre-listed products, then upload.",
  disabled,
}: BulkImportProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rowErrors, setRowErrors] = useState<RowError[] | null>(null);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadFile(templateUrl, templateFilename);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Failed to download template"));
    } finally {
      setDownloading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRowErrors(null);
    setUploading(true);
    try {
      const result = await onImport(file);
      const skippedNote = result.skipped ? ` (${result.skipped} duplicate row${result.skipped === 1 ? "" : "s"} skipped)` : "";
      toast.success(`Imported ${result.importedRows} row${result.importedRows === 1 ? "" : "s"}${skippedNote}`);
    } catch (err) {
      if (axios.isAxiosError(err) && Array.isArray(err.response?.data?.rowErrors)) {
        setRowErrors(err.response!.data.rowErrors as RowError[]);
        toast.error("The uploaded file has errors — see details below");
      } else {
        toast.error(apiErrorMessage(err, "Failed to import file"));
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={handleDownload} disabled={downloading || disabled}>
          {downloading ? "Preparing…" : "Download Template"}
        </button>
        <label className={`btn-secondary text-xs ${disabled ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
          {uploading ? "Importing…" : "Bulk Import"}
          <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileChange} disabled={uploading || disabled} />
        </label>
        <span className="text-xs text-muted">{hint}</span>
      </div>
      {rowErrors && rowErrors.length > 0 && (
        <div className="rounded-lg border border-danger/40 bg-danger-light/40 p-3 text-xs">
          <p className="mb-1 font-semibold text-danger">Fix these rows and re-upload:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {rowErrors.map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
