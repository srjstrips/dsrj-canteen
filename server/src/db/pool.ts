import { Pool, PoolClient, QueryResultRow } from "pg";
import { env } from "../config/env";

export const pool = new Pool({ connectionString: env.databaseUrl });

/** Anything query()/queryOne() can run against: the shared pool for a plain
 * read, or a checked-out client for statements inside withTransaction(). */
export type DbClient = Pool | PoolClient;

function toCamel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
    out[camelKey] = row[key];
  }
  return out;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  client: DbClient,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await client.query(text, params);
  return result.rows.map((row) => toCamel(row)) as T[];
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  client: DbClient,
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(client, text, params);
  return rows[0] ?? null;
}

/** Runs `fn` inside a BEGIN/COMMIT block on a single checked-out connection,
 * rolling back on any thrown error. Use for every multi-statement stock
 * transaction so the SELECT...FOR UPDATE locks and the following writes
 * share one connection. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
