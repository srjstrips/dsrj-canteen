import { DbClient, query } from "../db/pool";

export async function writeAudit(
  client: DbClient,
  params: {
    entity: string;
    entityId: string;
    action: string;
    actorId?: string | null;
    before?: unknown;
    after?: unknown;
  }
) {
  await query(
    client,
    `INSERT INTO audit_logs (entity, entity_id, action, actor_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      params.entity,
      params.entityId,
      params.action,
      params.actorId ?? null,
      params.before === undefined ? null : JSON.stringify(params.before),
      params.after === undefined ? null : JSON.stringify(params.after),
    ]
  );
}
