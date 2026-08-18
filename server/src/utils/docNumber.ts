function datePart(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/** Simple prefix-date-random suffix generator for document numbers where
 * strict sequential numbering isn't required (inward/issue). Bill numbers
 * (which need gap-free sequencing) use the dedicated BillCounter table
 * instead — see billing service. */
export function generateDocNo(prefix: string, date: Date = new Date()): string {
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${datePart(date)}-${rand}`;
}
