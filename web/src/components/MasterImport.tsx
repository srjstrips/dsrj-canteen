import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { BulkImport } from "./BulkImport";

interface MasterImportProps {
  /** Import entity key on the server, e.g. "suppliers", "products", "billing-accounts". */
  entity: string;
  filename: string;
  hint: string;
  /** React Query key to refresh after a successful import. */
  invalidateKey: unknown[];
}

/** "Download Template" + "Bulk Import" for a master list (blank template you
 * fill with new records). Wraps the shared BulkImport with the /imports API. */
export function MasterImport({ entity, filename, hint, invalidateKey }: MasterImportProps) {
  const queryClient = useQueryClient();
  return (
    <BulkImport
      templateUrl={`/imports/${entity}/template`}
      templateFilename={filename}
      hint={hint}
      onImport={async (file) => {
        const form = new FormData();
        form.append("file", file);
        const res = await api.post(`/imports/${entity}/import`, form);
        queryClient.invalidateQueries({ queryKey: invalidateKey });
        return res.data as { importedRows: number; skipped?: number };
      }}
    />
  );
}
