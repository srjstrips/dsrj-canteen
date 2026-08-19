-- Divya SRJ Canteen — Managed Orders (OT / Guest / Contractor)
-- Adds the HOD/HR module: HOD places single-person orders for OT, Guest and
-- Contractor diners; the canteen manager serves them and records any extras,
-- which the placing HOD confirms or rejects. Confirmed/served items roll up
-- into a monthly consolidated bill per billing account. See ARCHITECTURE.md.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- HOD/HR operate the module. HOD and HR are the same role here.
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'HOD';

CREATE TYPE managed_order_type AS ENUM ('OT', 'GUEST', 'CONTRACTOR');
CREATE TYPE managed_order_status AS ENUM ('PLACED', 'SERVED', 'CANCELLED');
CREATE TYPE billing_account_type AS ENUM ('COMPANY', 'CONTRACTOR');
-- Extras eaten during the meal need the placing HOD's confirmation before they
-- are billed. Standard (non-extra) items are always 'CONFIRMED'.
CREATE TYPE extra_status AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- Billing accounts — who receives the month-end consolidated bill.
-- One COMPANY account covers OT + Guest; each contractor firm is its own row.
-- ---------------------------------------------------------------------------

CREATE TABLE billing_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  type         billing_account_type NOT NULL,
  contact_person TEXT,
  mobile       TEXT,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, type)
);

-- ---------------------------------------------------------------------------
-- Managed orders — one order = one person (spec: comma-separated names entered
-- by the HOD are split into separate single-person orders).
-- ---------------------------------------------------------------------------

CREATE TABLE managed_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      TEXT NOT NULL UNIQUE,
  order_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  order_type    managed_order_type NOT NULL,
  account_id    UUID NOT NULL REFERENCES billing_accounts (id),
  diner_name    TEXT NOT NULL,
  shift         TEXT,
  status        managed_order_status NOT NULL DEFAULT 'PLACED',
  placed_by_id  UUID NOT NULL REFERENCES users (id),   -- HOD who placed it
  served_by_id  UUID REFERENCES users (id),            -- canteen manager
  served_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_managed_orders_date ON managed_orders (order_date);
CREATE INDEX idx_managed_orders_status ON managed_orders (status);
CREATE INDEX idx_managed_orders_account ON managed_orders (account_id);
CREATE INDEX idx_managed_orders_diner ON managed_orders (lower(diner_name));

-- ---------------------------------------------------------------------------
-- Managed order items — the food lines. is_extra=false lines are placed by the
-- HOD up front; is_extra=true lines are added by the canteen manager during the
-- meal and need the placing HOD's confirmation (extra_status).
-- ---------------------------------------------------------------------------

CREATE TABLE managed_order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES managed_orders (id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES products (id),
  quantity      NUMERIC(14, 3) NOT NULL,
  rate          NUMERIC(14, 2) NOT NULL,
  amount        NUMERIC(14, 2) NOT NULL,
  is_extra      BOOLEAN NOT NULL DEFAULT FALSE,
  extra_status  extra_status NOT NULL DEFAULT 'CONFIRMED',
  confirmed_by_id UUID REFERENCES users (id),  -- HOD who confirmed/rejected the extra
  confirmed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_managed_order_items_order ON managed_order_items (order_id);
CREATE INDEX idx_managed_order_items_product ON managed_order_items (product_id);

-- Per-day sequence for human-readable order numbers (mirrors bill_counters).
CREATE TABLE managed_order_counters (
  order_date DATE PRIMARY KEY,
  last_seq   INTEGER NOT NULL DEFAULT 0
);
