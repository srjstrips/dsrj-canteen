-- Store Expenses: record any miscellaneous expense (delivery, grinding, labour, etc.)
CREATE TABLE IF NOT EXISTS store_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  expense_no    TEXT NOT NULL UNIQUE,
  invoice_no    TEXT,
  notes         TEXT,
  total_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by_id UUID NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_expense_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id    UUID NOT NULL REFERENCES store_expenses(id) ON DELETE CASCADE,
  expense_name  TEXT NOT NULL,
  qty           NUMERIC(12,3) NOT NULL DEFAULT 1,
  rate          NUMERIC(12,2) NOT NULL,
  gst_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount        NUMERIC(12,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
