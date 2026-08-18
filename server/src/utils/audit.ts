import { Prisma, PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient | PrismaClient;

export async function writeAudit(
  tx: Tx,
  params: {
    entity: string;
    entityId: string;
    action: string;
    actorId?: string | null;
    before?: unknown;
    after?: unknown;
  }
) {
  await tx.auditLog.create({
    data: {
      entity: params.entity,
      entityId: params.entityId,
      action: params.action,
      actorId: params.actorId ?? null,
      before: params.before === undefined ? Prisma.JsonNull : (params.before as Prisma.InputJsonValue),
      after: params.after === undefined ? Prisma.JsonNull : (params.after as Prisma.InputJsonValue),
    },
  });
}
