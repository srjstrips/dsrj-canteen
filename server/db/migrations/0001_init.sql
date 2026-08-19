-- Divya SRJ Canteen — Inventory & Billing System
-- Initial schema. See docs/ARCHITECTURE.md for the design rationale.
-- gen_random_uuid() is built into PostgreSQL 13+ core (no extension needed).

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE role_enum AS ENUM ('ADMIN', 'STORE', 'CANTEEN');
CREATE TYPE payment_mode AS ENUM ('CASH', 'UPI', 'CREDIT');
CREATE TYPE store_ledger_txn_type AS ENUM ('OPENING', 'INWARD', 'ISSUE', 'ADJUSTMENT');
CREATE TYPE canteen_ledger_txn_type AS ENUM ('RECEIVED', 'SALE', 'CONSUMPTION', 'WASTAGE', 'ADJUSTMENT');
CREATE TYPE wastage_reason AS ENUM ('SPOILAGE', 'EXPIRED', 'PREPARATION_WASTE', 'DAMAGED', 'EXCESS_PREPARATION', 'OTHER');
CREATE TYPE stock_area AS ENUM ('STORE', 'CANTEEN');
CREATE TYPE sale_status AS ENUM ('COMPLETED', 'CANCELLED');

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          role_enum NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Masters
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  symbol     TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  contact_person TEXT,
  mobile         TEXT,
  address        TEXT,
  gst_number     TEXT,
  payment_terms  TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_suppliers_name ON suppliers (name);

CREATE TABLE products (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  category_id         UUID NOT NULL REFERENCES categories (id),
  unit_id             UUID NOT NULL REFERENCES units (id),
  min_stock_level     NUMERIC(14, 3) NOT NULL DEFAULT 0,
  reorder_level       NUMERIC(14, 3) NOT NULL DEFAULT 0,
  -- Whether a POS sale of this product directly draws down Canteen stock
  -- (packaged goods sold as-is) vs. being a prepared item whose ingredients
  -- are drawn down separately via Consumption. See ARCHITECTURE.md §4.
  track_canteen_stock BOOLEAN NOT NULL DEFAULT TRUE,
  sell_price          NUMERIC(14, 2),
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, unit_id)
);
CREATE INDEX idx_products_category ON products (category_id);

-- ---------------------------------------------------------------------------
-- STORE — Stock Inward (Supplier -> Store)
-- ---------------------------------------------------------------------------

CREATE TABLE stock_inwards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inward_no      TEXT NOT NULL UNIQUE,
  inward_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id    UUID NOT NULL REFERENCES suppliers (id),
  invoice_number TEXT,
  total_value    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_by_id  UUID NOT NULL REFERENCES users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_inwards_supplier ON stock_inwards (supplier_id);
CREATE INDEX idx_stock_inwards_date ON stock_inwards (inward_date);

CREATE TABLE stock_inward_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_inward_id UUID NOT NULL REFERENCES stock_inwards (id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES products (id),
  quantity        NUMERIC(14, 3) NOT NULL,
  rate            NUMERIC(14, 4) NOT NULL,
  total_value     NUMERIC(14, 2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_inward_items_product ON stock_inward_items (product_id);

-- ---------------------------------------------------------------------------
-- STORE — Stock Issue (Store -> Canteen)
-- ---------------------------------------------------------------------------

CREATE TABLE stock_issues (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_no      TEXT NOT NULL UNIQUE,
  issue_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  total_value   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  created_by_id UUID NOT NULL REFERENCES users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_issues_date ON stock_issues (issue_date);

CREATE TABLE stock_issue_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_issue_id       UUID NOT NULL REFERENCES stock_issues (id) ON DELETE CASCADE,
  product_id           UUID NOT NULL REFERENCES products (id),
  quantity             NUMERIC(14, 3) NOT NULL,
  issue_rate           NUMERIC(14, 4) NOT NULL,
  issue_value          NUMERIC(14, 2) NOT NULL,
  previous_balance     NUMERIC(14, 3) NOT NULL,
  balance_after_issue  NUMERIC(14, 3) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_issue_items_product ON stock_issue_items (product_id);

-- ---------------------------------------------------------------------------
-- STORE — current balance (cache of the ledger) + ledger (source of truth)
-- ---------------------------------------------------------------------------

CREATE TABLE store_stock_balances (
  product_id  UUID PRIMARY KEY REFERENCES products (id),
  quantity    NUMERIC(14, 3) NOT NULL DEFAULT 0,
  avg_rate    NUMERIC(14, 4) NOT NULL DEFAULT 0,
  stock_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE store_stock_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products (id),
  txn_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  txn_type      store_ledger_txn_type NOT NULL,
  ref_id        UUID,
  inward_qty    NUMERIC(14, 3) NOT NULL DEFAULT 0,
  issue_qty     NUMERIC(14, 3) NOT NULL DEFAULT 0,
  rate          NUMERIC(14, 4) NOT NULL,
  balance_qty   NUMERIC(14, 3) NOT NULL,
  balance_value NUMERIC(14, 2) NOT NULL,
  remarks       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_store_ledger_product_date ON store_stock_ledger (product_id, txn_date);

-- ---------------------------------------------------------------------------
-- CANTEEN — current balance + ledger
-- ---------------------------------------------------------------------------

CREATE TABLE canteen_stock_balances (
  product_id  UUID PRIMARY KEY REFERENCES products (id),
  quantity    NUMERIC(14, 3) NOT NULL DEFAULT 0,
  avg_rate    NUMERIC(14, 4) NOT NULL DEFAULT 0,
  stock_value NUMERIC(14, 2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE canteen_stock_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products (id),
  txn_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
  txn_type      canteen_ledger_txn_type NOT NULL,
  ref_id        UUID,
  in_qty        NUMERIC(14, 3) NOT NULL DEFAULT 0,
  out_qty       NUMERIC(14, 3) NOT NULL DEFAULT 0,
  rate          NUMERIC(14, 4) NOT NULL,
  balance_qty   NUMERIC(14, 3) NOT NULL,
  balance_value NUMERIC(14, 2) NOT NULL,
  remarks       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canteen_ledger_product_date ON canteen_stock_ledger (product_id, txn_date);

-- ---------------------------------------------------------------------------
-- CANTEEN — Billing / Sales
-- ---------------------------------------------------------------------------

CREATE TABLE sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_no        TEXT NOT NULL UNIQUE,
  bill_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  bill_time      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sub_total      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(14, 2) NOT NULL DEFAULT 0,
  grand_total    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_mode   payment_mode NOT NULL,
  status         sale_status NOT NULL DEFAULT 'COMPLETED',
  customer_ref   TEXT,
  -- Client-generated id set by the offline POS queue so a bill retried after
  -- reconnecting is never posted twice. Null for bills created while online.
  client_ref     TEXT UNIQUE,
  created_by_id  UUID NOT NULL REFERENCES users (id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_date ON sales (bill_date);
CREATE INDEX idx_sales_payment_mode ON sales (payment_mode);

CREATE TABLE sale_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    UUID NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products (id),
  quantity   NUMERIC(14, 3) NOT NULL,
  rate       NUMERIC(14, 2) NOT NULL,
  discount   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  amount     NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_items_product ON sale_items (product_id);

-- ---------------------------------------------------------------------------
-- CANTEEN — Wastage
-- ---------------------------------------------------------------------------

CREATE TABLE wastage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wastage_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  product_id    UUID NOT NULL REFERENCES products (id),
  quantity      NUMERIC(14, 3) NOT NULL,
  rate          NUMERIC(14, 4) NOT NULL,
  wastage_value NUMERIC(14, 2) NOT NULL,
  reason        wastage_reason NOT NULL,
  notes         TEXT,
  created_by_id UUID NOT NULL REFERENCES users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_wastage_product_date ON wastage (product_id, wastage_date);

-- ---------------------------------------------------------------------------
-- Stock Adjustments (authorized corrections, Store or Canteen)
-- ---------------------------------------------------------------------------

CREATE TABLE stock_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  area            stock_area NOT NULL,
  product_id      UUID NOT NULL REFERENCES products (id),
  quantity_delta  NUMERIC(14, 3) NOT NULL,
  rate            NUMERIC(14, 4) NOT NULL,
  value_delta     NUMERIC(14, 2) NOT NULL,
  reason          TEXT NOT NULL,
  created_by_id   UUID NOT NULL REFERENCES users (id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_adjustments_product ON stock_adjustments (product_id);

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor_id   UUID REFERENCES users (id),
  before     JSONB,
  after      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity, entity_id);

-- ---------------------------------------------------------------------------
-- Daily bill numbering counter (avoids collisions/gaps under concurrency)
-- ---------------------------------------------------------------------------

CREATE TABLE bill_counters (
  bill_date DATE PRIMARY KEY,
  last_seq  INTEGER NOT NULL DEFAULT 0
);
