-- Canteen -> Store returns. At month-end the canteen returns unused issued
-- stock back to the store. This is the reverse of a Stock Issue: canteen stock
-- decreases, store stock increases, valued at the canteen's average rate.

ALTER TYPE store_ledger_txn_type ADD VALUE IF NOT EXISTS 'RETURN';
ALTER TYPE canteen_ledger_txn_type ADD VALUE IF NOT EXISTS 'RETURN';

CREATE TABLE stock_returns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no     TEXT NOT NULL UNIQUE,
  return_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  total_value   NUMERIC(14, 2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by_id UUID NOT NULL REFERENCES users (id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_returns_date ON stock_returns (return_date);

CREATE TABLE stock_return_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_return_id        UUID NOT NULL REFERENCES stock_returns (id) ON DELETE CASCADE,
  product_id             UUID NOT NULL REFERENCES products (id),
  quantity               NUMERIC(14, 3) NOT NULL,
  return_rate            NUMERIC(14, 4) NOT NULL,   -- canteen avg rate at return time
  return_value           NUMERIC(14, 2) NOT NULL,
  canteen_balance_after  NUMERIC(14, 3) NOT NULL,
  store_balance_after    NUMERIC(14, 3) NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_return_items_product ON stock_return_items (product_id);
