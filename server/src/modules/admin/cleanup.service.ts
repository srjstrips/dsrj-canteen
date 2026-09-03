import { PoolClient } from "pg";
import { withTransaction } from "../../db/pool";
import { ApiError } from "../../utils/ApiError";
import { D } from "../../utils/money";
import { writeAudit } from "../../utils/audit";

// Selectable deletion scopes. Each removes its records plus the exact ledger
// rows they created; stock balances are recomputed afterwards.
export const CLEANUP_SCOPES = [
  "POS_SALES", // canteen counter bills
  "MANAGED_ORDERS", // OT / Guest / Contractor orders
  "STORE_INWARD", // supplier -> store inward
  "STORE_ISSUES", // store -> canteen issues
  "STOCK_RETURNS", // canteen -> store returns
  "WASTAGE",
  "CONSUMPTION",
  "ADJUSTMENTS",
  "FOOD_ITEMS", // food menu products (no stock impact)
  "SUPPLIERS", // suppliers with no inward records
  "STORE_PRODUCTS", // raw material products with no stock history
  "EMPTY_CATEGORIES", // categories with no products
] as const;
export type CleanupScope = (typeof CLEANUP_SCOPES)[number];

interface Range {
  from?: Date;
  to?: Date;
}

// Builds a "col >= from AND col <= to" clause with positional params.
function dateClause(col: string, r: Range, params: unknown[]): string {
  const parts: string[] = [];
  if (r.from) {
    params.push(r.from);
    parts.push(`${col} >= $${params.length}`);
  }
  if (r.to) {
    params.push(r.to);
    parts.push(`${col} <= $${params.length}`);
  }
  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

async function delReturningIds(client: PoolClient, table: string, dateCol: string, r: Range): Promise<string[]> {
  const params: unknown[] = [];
  const where = dateClause(dateCol, r, params);
  const res = await client.query(`DELETE FROM ${table} ${where} RETURNING id`, params);
  return res.rows.map((row) => row.id as string);
}

async function delLedgerByRef(client: PoolClient, table: string, txnType: string, ids: string[]) {
  if (ids.length === 0) return;
  await client.query(`DELETE FROM ${table} WHERE txn_type = $1 AND ref_id = ANY($2::uuid[])`, [txnType, ids]);
}

async function delLedgerByTypeDate(client: PoolClient, table: string, txnType: string, r: Range) {
  const params: unknown[] = [txnType];
  const parts = ["txn_type = $1"];
  if (r.from) {
    params.push(r.from);
    parts.push(`txn_date >= $${params.length}`);
  }
  if (r.to) {
    params.push(r.to);
    parts.push(`txn_date <= $${params.length}`);
  }
  await client.query(`DELETE FROM ${table} WHERE ${parts.join(" AND ")}`, params);
}

/**
 * Rebuilds a stock-balances table by replaying its ledger from scratch
 * (weighted-average). Called after deletions so balances always match the
 * remaining ledger — no matter what was removed.
 */
async function recomputeBalances(
  client: PoolClient,
  ledgerTable: string,
  balanceTable: string,
  inCol: string,
  outCol: string
) {
  const rows = await client.query(
    `SELECT product_id, txn_date, ${inCol} AS in_qty, ${outCol} AS out_qty, rate
     FROM ${ledgerTable} ORDER BY product_id, txn_date, id`
  );
  const state = new Map<string, { qty: import("decimal.js").default; value: import("decimal.js").default }>();
  for (const row of rows.rows as { product_id: string; in_qty: string; out_qty: string; rate: string }[]) {
    const s = state.get(row.product_id) ?? { qty: D(0), value: D(0) };
    const inQty = D(row.in_qty);
    const outQty = D(row.out_qty);
    if (inQty.gt(0)) {
      s.value = s.value.add(inQty.mul(row.rate));
      s.qty = s.qty.add(inQty);
    }
    if (outQty.gt(0)) {
      const avg = s.qty.gt(0) ? s.value.div(s.qty) : D(0);
      s.value = s.value.sub(outQty.mul(avg));
      s.qty = s.qty.sub(outQty);
    }
    state.set(row.product_id, s);
  }

  // Reset every balance row, then write back the replayed totals.
  await client.query(`UPDATE ${balanceTable} SET quantity = 0, stock_value = 0${balanceTable.includes("canteen") || balanceTable.includes("store") ? ", avg_rate = 0" : ""}, updated_at = now()`);
  for (const [productId, s] of state) {
    const avg = s.qty.gt(0) ? s.value.div(s.qty) : D(0);
    await client.query(
      `INSERT INTO ${balanceTable} (product_id, quantity, avg_rate, stock_value, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (product_id) DO UPDATE SET quantity = $2, avg_rate = $3, stock_value = $4, updated_at = now()`,
      [productId, s.qty.toString(), avg.toString(), s.value.toString()]
    );
  }
}

export async function runCleanup(scopes: CleanupScope[], range: Range, actorId: string) {
  if (scopes.length === 0) throw ApiError.badRequest("Select at least one thing to delete");

  return withTransaction(async (client) => {
    let touchedStore = false;
    let touchedCanteen = false;

    for (const scope of scopes) {
      switch (scope) {
        case "POS_SALES": {
          const ids = await delReturningIds(client, "sales", "bill_date", range);
          await delLedgerByRef(client, "canteen_stock_ledger", "SALE", ids);
          // Reset bill counters so next bill starts from 0001 when all sales cleared.
          if (!range.from && !range.to) {
            await client.query("TRUNCATE bill_counters");
          } else {
            const p: unknown[] = [];
            const w = dateClause("bill_date", range, p);
            await client.query(`DELETE FROM bill_counters ${w}`, p);
          }
          touchedCanteen = true;
          break;
        }
        case "MANAGED_ORDERS": {
          const ids = await delReturningIds(client, "managed_orders", "order_date", range);
          await delLedgerByRef(client, "canteen_stock_ledger", "SALE", ids);
          touchedCanteen = true;
          break;
        }
        case "STORE_INWARD": {
          const ids = await delReturningIds(client, "stock_inwards", "inward_date", range);
          await delLedgerByRef(client, "store_stock_ledger", "INWARD", ids);
          touchedStore = true;
          break;
        }
        case "STORE_ISSUES": {
          // Canteen RECEIVED rows reference issue-item ids — capture before cascade.
          const p: unknown[] = [];
          const w = dateClause("issue_date", range, p);
          const itemRes = await client.query(
            `SELECT id FROM stock_issue_items WHERE stock_issue_id IN (SELECT id FROM stock_issues ${w})`,
            p
          );
          const itemIds = itemRes.rows.map((row) => row.id as string);
          await delLedgerByRef(client, "canteen_stock_ledger", "RECEIVED", itemIds);
          const ids = await delReturningIds(client, "stock_issues", "issue_date", range);
          await delLedgerByRef(client, "store_stock_ledger", "ISSUE", ids);
          touchedStore = true;
          touchedCanteen = true;
          break;
        }
        case "STOCK_RETURNS": {
          const p: unknown[] = [];
          const w = dateClause("return_date", range, p);
          const itemRes = await client.query(
            `SELECT id FROM stock_return_items WHERE stock_return_id IN (SELECT id FROM stock_returns ${w})`,
            p
          );
          const itemIds = itemRes.rows.map((row) => row.id as string);
          await delLedgerByRef(client, "canteen_stock_ledger", "RETURN", itemIds);
          const ids = await delReturningIds(client, "stock_returns", "return_date", range);
          await delLedgerByRef(client, "store_stock_ledger", "RETURN", ids);
          touchedStore = true;
          touchedCanteen = true;
          break;
        }
        case "WASTAGE": {
          const p: unknown[] = [];
          const w = dateClause("wastage_date", range, p);
          await client.query(`DELETE FROM wastage ${w}`, p);
          await delLedgerByTypeDate(client, "canteen_stock_ledger", "WASTAGE", range);
          touchedCanteen = true;
          break;
        }
        case "CONSUMPTION": {
          await delLedgerByTypeDate(client, "canteen_stock_ledger", "CONSUMPTION", range);
          touchedCanteen = true;
          break;
        }
        case "ADJUSTMENTS": {
          const p: unknown[] = [];
          const w = dateClause("created_at", range, p);
          await client.query(`DELETE FROM stock_adjustments ${w}`, p);
          await delLedgerByTypeDate(client, "store_stock_ledger", "ADJUSTMENT", range);
          await delLedgerByTypeDate(client, "canteen_stock_ledger", "ADJUSTMENT", range);
          touchedStore = true;
          touchedCanteen = true;
          break;
        }
        case "FOOD_ITEMS": {
          // Delete food menu products (track_canteen_stock=FALSE) that have never been billed.
          const inUse = await client.query(
            `SELECT DISTINCT product_id FROM sale_items
             UNION SELECT DISTINCT product_id FROM managed_order_items`
          );
          const usedIds = inUse.rows.map((r) => r.product_id as string);
          if (usedIds.length > 0) {
            await client.query(
              `DELETE FROM products WHERE track_canteen_stock = FALSE AND id != ALL($1::uuid[])`,
              [usedIds]
            );
          } else {
            await client.query(`DELETE FROM products WHERE track_canteen_stock = FALSE`);
          }
          break;
        }
        case "SUPPLIERS": {
          // Delete suppliers that have no stock inward records.
          await client.query(
            `DELETE FROM suppliers WHERE id NOT IN (SELECT DISTINCT supplier_id FROM stock_inwards)`
          );
          break;
        }
        case "STORE_PRODUCTS": {
          // Delete raw material products (is_food=FALSE) that have no stock history.
          await client.query(
            `DELETE FROM products p
             USING categories c
             WHERE p.category_id = c.id AND c.is_food = FALSE
               AND p.id NOT IN (SELECT DISTINCT product_id FROM store_stock_ledger)
               AND p.id NOT IN (SELECT DISTINCT product_id FROM canteen_stock_ledger)`
          );
          break;
        }
        case "EMPTY_CATEGORIES": {
          // Delete categories that have no products at all.
          await client.query(
            `DELETE FROM categories WHERE id NOT IN (SELECT DISTINCT category_id FROM products)`
          );
          break;
        }
      }
    }

    if (touchedStore) await recomputeBalances(client, "store_stock_ledger", "store_stock_balances", "inward_qty", "issue_qty");
    if (touchedCanteen) await recomputeBalances(client, "canteen_stock_ledger", "canteen_stock_balances", "in_qty", "out_qty");

    await writeAudit(client, {
      entity: "System",
      entityId: "cleanup",
      action: "CLEANUP",
      actorId,
      after: { scopes, from: range.from ?? null, to: range.to ?? null },
    });

    return { ok: true, scopes };
  });
}
