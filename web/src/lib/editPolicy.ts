import { AuthUser } from "../types";

export const EDIT_WINDOW_HOURS = 24;

/** Whether the current user may edit/delete an entry created at `createdAt`:
 * ADMIN or a user granted "edit old entries" can always edit; everyone else
 * only within the 24-hour window. Mirrors the server-side policy. */
export function canEditEntry(user: AuthUser | null, createdAt?: string | null): boolean {
  if (!user) return false;
  if (user.role === "ADMIN" || user.canEditOld) return true;
  if (!createdAt) return false;
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);
  return ageHours <= EDIT_WINDOW_HOURS;
}
