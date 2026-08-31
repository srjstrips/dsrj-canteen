import { pool, queryOne } from "../db/pool";
import { ApiError } from "./ApiError";
import { Role } from "../types/domain";

export const EDIT_WINDOW_HOURS = 24;

/**
 * Enforces the edit/delete policy for a created record:
 *  - ADMIN: always allowed.
 *  - user with can_edit_old = TRUE: always allowed (granted by admin).
 *  - everyone else: only within EDIT_WINDOW_HOURS of `createdAt`.
 * Throws 403 otherwise.
 */
export async function assertCanEdit(userId: string, role: Role, createdAt: Date | string) {
  if (role === Role.ADMIN) return;

  const user = await queryOne<{ canEditOld: boolean }>(pool, 'SELECT can_edit_old AS "canEditOld" FROM users WHERE id = $1', [userId]);
  if (user?.canEditOld) return;

  const created = new Date(createdAt).getTime();
  const ageHours = (Date.now() - created) / (1000 * 60 * 60);
  if (ageHours > EDIT_WINDOW_HOURS) {
    throw ApiError.forbidden(`This entry is older than ${EDIT_WINDOW_HOURS} hours and can only be edited by an authorized user`);
  }
}
