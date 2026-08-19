# Divya SRJ Canteen — Inventory & Billing System
## Architecture & Database Design

## 1. Business Flow

```
Supplier -> Store Stock Inward -> Store Stock -> Issue to Canteen -> Canteen Stock -> Sale/Billing -> Customer
```

Store and Canteen keep **independent stock balances**. Stock only ever moves from
Store -> Canteen via an explicit "Stock Issue" transaction. Canteen stock is
reduced by Sales, Consumption, Wastage, or a manual signed Adjustment.

Every quantity/value on screen is **derived from ledger transactions**, never
typed in directly. The only user-entered numbers are: inward qty/rate, issue
qty, sale qty, wastage qty, consumption qty, and adjustment qty(+reason). All
running balances, average rates and totals are computed by the server inside
a DB transaction and persisted as ledger rows + a denormalized "current
balance" row per product that is *only* ever written by the ledger-posting
code path.

## 2. Roles & Access

| Role | Access |
|---|---|
| `ADMIN` | Everything: user management, all masters, both stock modules, billing, all reports, stock adjustments |
| `STORE` | Store dashboard, product/supplier master (create/edit), stock inward, store stock, stock issue, store stock ledger, store reports. No billing, no canteen stock edits. |
| `CANTEEN` | Canteen dashboard, received stock (read-only), canteen stock, billing/POS, daily sales, consumption, wastage, canteen reports. No store inward/issue/rate edits. |

Enforced with a JWT (`role` claim) + Express middleware (`requireRole(...roles)`).
`ADMIN` implicitly passes every `requireRole` check. There is no page a role
can reach in the UI that isn't also independently enforced on the API.

## 3. Core Stock Transaction Engine

### 3.1 Store side — Moving Weighted Average

State per product lives in `store_stock_balances` (one row per product):
`quantity`, `avg_rate`, `stock_value`. `stock_value` is the running ledger
total (sum of inward values minus issue values-at-the-time), **not** simply
`quantity * avg_rate` — `avg_rate` is a rounded (2dp) per-unit price that is
only ever recomputed on a new INWARD and stays fixed across issues, exactly
matching the spec's own worked examples (§8-10: issue value = qty × the
*rounded* current average rate; the small rounding remainder stays in
`stock_value` rather than being redistributed into the rate).

**Stock Inward** (`POST /api/store/stock-inward`), inside one DB transaction:
1. `SELECT ... FOR UPDATE` the product's `store_stock_balances` row (create it
   at zero if missing) — this serializes concurrent inwards/issues per product.
2. `openingQty, openingRate = current balance`
3. `newQty = openingQty + inwardQty`
4. `newValue = (openingQty * openingRate) + (inwardQty * inwardRate)`
5. `newAvgRate = newQty > 0 ? newValue / newQty : 0`
6. Update balance row to `(newQty, newAvgRate)`.
7. Insert immutable `stock_inwards` header + `stock_inward_items` row(s) at
   the rate actually paid (never overwritten later).
8. Insert a `store_stock_ledger` row: `txn_type=INWARD, inward_qty, issue_qty=0,
   balance_qty=newQty, rate=newAvgRate, balance_value=newQty*newAvgRate`.
9. Write `audit_logs`.

This is exactly the formula in spec §7-11: existing value + new value, divided
by combined quantity. Old ledger/inward rows are never rewritten — the average
rate is a derived, current-only number.

**Stock Issue to Canteen** (`POST /api/store/stock-issue`):
1. Lock the same balance row.
2. If `issueQty > quantity` -> `400 "Insufficient stock. Available quantity: X."`
3. `issueValue = round2(issueQty * avg_rate)` (avg_rate unchanged by an issue —
   only quantity and value drop; rate never moves on an issue, per spec §9).
4. `remainingValue = stock_value - issueValue`, `remainingQty = quantity - issueQty`.
   `avg_rate` is kept as-is (not recomputed from remainingValue/remainingQty)
   so rounding never drifts the rate across many small issues.
5. Update store balance, insert `stock_issues` + `stock_issue_items`, insert a
   `store_stock_ledger` row (`txn_type=ISSUE`).
6. In the **same transaction**, create the Canteen side: upsert
   `canteen_stock_balances` (received qty adds in at the store issue rate,
   using the same weighted-average formula so canteen also tracks its own
   average cost) and insert a `canteen_stock_ledger` row (`txn_type=RECEIVED`).

Because both sides are written in one DB transaction, Store Issue and Canteen
Received can never disagree.

### 3.2 Canteen side

`canteen_stock_balances`: `quantity`, `avg_rate`, `stock_value`, derived the
same way. Reduced by:
- `SALE` — posted by the billing engine when a bill is created (only for
  products flagged `track_canteen_stock`; see §4).
- `WASTAGE` — Wastage module, requires a reason.
- `CONSUMPTION` — internal use (food prep) module.
- `ADJUSTMENT` — signed correction, ADMIN/CANTEEN only, requires a note, never
  silently changes history (adds a ledger row, doesn't edit old ones).

All four go through one internal `postCanteenLedger()` function so the
"never go negative" and "never hand-edit the balance" rules are enforced in
exactly one place.

### 3.3 Ledger immutability

`store_stock_ledger` and `canteen_stock_ledger` rows are append-only (no
UPDATE/DELETE routes exist for them). Mistakes are corrected with a reversing
adjustment/cancellation transaction that references the original
(`reversal_of_id`), never by editing history — satisfies spec §11/§22/§24.

## 4. Billing / POS

`sales` (header: bill number, date/time, payment mode, totals, created_by) +
`sale_items` (product, qty, rate snapshot at sale time, discount, amount).
Bill numbers are generated `DSRJ-YYYYMMDD-#####`, sequential per day, assigned
inside the same transaction that inserts the sale (`SELECT ... FOR UPDATE` on
a per-day counter row) so numbers never collide or gap under concurrency.
Posting a sale also posts a `SALE` canteen ledger entry per line item that has
`track_canteen_stock = true` on its product (e.g. a packaged water bottle
sold 1:1 draws down canteen stock; a made-to-order tea need not, since its
ingredients are drawn down instead via Consumption) — this is the
"ingredients vs. direct-sale products" split the spec calls out in §14 as
needing separate treatment.

## 5. Database Schema (PostgreSQL, plain SQL via `pg`)

No ORM: the schema is hand-written SQL in `server/db/migrations/*.sql`,
applied by a small migration runner (`server/src/db/migrate.ts`) that tracks
what's been applied in a `schema_migrations` table — add a new numbered
`.sql` file for any future change rather than editing an applied one. The
app talks to Postgres directly through `pg` (`server/src/db/pool.ts`
exports a `Pool`, `query`/`queryOne` helpers that camelCase result rows, and
`withTransaction` for multi-statement work) — see `server/db/migrations/0001_init.sql`
for the authoritative, fully-typed definition with indexes/constraints.

Core tables:

- `users`, with `role` enum (`ADMIN`, `STORE`, `CANTEEN`)
- `categories`, `units`, `products` (FK category/unit, `min_stock_level`,
  `reorder_level`, `track_canteen_stock`, `active`)
- `suppliers`
- `stock_inwards` (header) / `stock_inward_items` (line items, one row per
  product per invoice — quantity/rate immutable after posting)
- `stock_issues` (header) / `stock_issue_items`
- `store_stock_balances` (1 row per product — the only "current state" table
  on the Store side, always rebuildable from `store_stock_ledger`)
- `store_stock_ledger` (append-only, one row per movement)
- `canteen_stock_balances`, `canteen_stock_ledger` (mirror of the above for
  Canteen; ledger `txn_type` in `RECEIVED|SALE|CONSUMPTION|WASTAGE|ADJUSTMENT`)
- `sales` / `sale_items`
- `wastage` (also mirrored into `canteen_stock_ledger`)
- `stock_adjustments` (Store or Canteen, ADMIN-authorized corrections)
- `audit_logs` (polymorphic: `entity`, `entity_id`, `action`, `actor_id`,
  `before`/`after` JSON, `created_at`)

All monetary columns are `Decimal(14,4)` (rate) / `Decimal(14,2)` (value) —
never floating point — to avoid weighted-average rounding drift. All tables
carry `created_at`; mutable ones carry `updated_at`, `created_by`, `updated_by`.

## 6. API Structure

REST, JSON, JWT bearer auth. Namespaced by module, each route wrapped in
`requireAuth` + `requireRole(...)`:

```
POST   /api/auth/login
GET    /api/auth/me

/api/admin/users                 (ADMIN)
/api/masters/products|categories|units|suppliers   (ADMIN, STORE=read/write products+suppliers, CANTEEN=read)

/api/store/stock-inward          (ADMIN, STORE)
/api/store/stock-issue           (ADMIN, STORE)
/api/store/stock                 (current balances)                (+ CANTEEN/ADMIN read)
/api/store/ledger/:productId
/api/store/dashboard
/api/store/reports/*

/api/canteen/received-stock      (read-only, from stock_issues)
/api/canteen/stock                (ADMIN, CANTEEN)
/api/canteen/consumption
/api/canteen/wastage
/api/canteen/adjustments
/api/canteen/sales (POS create/list), /api/canteen/sales/daily-summary
/api/canteen/dashboard
/api/canteen/reports/*

/api/admin/dashboard
/api/reports/management/*
```

## 6a. Bulk entry via Excel

Stock Inward and Stock Issue both support a bulk path alongside the manual
line-by-line form: `GET /api/store/stock-inward/template` (and the
`stock-issue` equivalent) returns an `.xlsx` pre-filled with every active
Product Master row (ID/Name/Unit, plus current average rate for issues) —
the user only fills in Quantity (and Rate, for inward) against products that
already exist, never free-typing a name (spec §3). `POST .../import` (multipart,
field `file`) parses the filled sheet server-side with `exceljs`, validates
every non-blank row, and — only if the whole file is valid — feeds the parsed
rows into the exact same `recordStockInward`/`issueStockToCanteen` functions
the manual form calls, so bulk entry goes through identical weighted-average
and insufficient-stock checks. A file with any invalid row is rejected whole
with a per-row error list rather than partially imported.

## 7. Frontend

React 18 + TypeScript + Vite, React Router, TanStack Query for server state,
Tailwind CSS themed per spec §20 (off-white background, white cards, orange
`#F97316` primary, dark text, green available / red low-stock accents).
Sidebar nav renders module list filtered by the logged-in user's role.
Configured as an installable **PWA**: Workbox caches the app shell and last-seen
GET responses, and the POS billing screen queues bills into IndexedDB when
offline, auto-flushing to `/api/canteen/sales` on reconnect (`navigator
onLine` + background `sync` retry) — bills created offline show a "pending
sync" badge until confirmed by the server.

## 8. Why not a naive CRUD table for stock

A `products` table with an `on_hand_qty` column that inward/issue/sale forms
`UPDATE ... SET on_hand_qty = on_hand_qty +/- x` against would (a) have no
history, (b) be unable to reconstruct "what was the rate on 5-Aug", and (c)
be one race condition away from being wrong. Instead stock is a materialized,
lock-protected *projection* of the ledger: the ledger is the source of truth,
the balance table is a cache of "ledger reduced to now" kept consistent by
being written only inside the same transaction as the ledger insert.
