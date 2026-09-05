-- Contractor Token System
-- Admin assigns a token balance to each contractor billing account.
-- Each token = 1 meal. Canteen deducts tokens when serving labours.
-- Tokens never expire; balance carries forward indefinitely.

CREATE TYPE token_txn_type AS ENUM ('TOPUP', 'DEDUCT', 'RESET');

CREATE TABLE contractor_token_transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES billing_accounts(id),
  txn_type    token_txn_type NOT NULL,
  quantity    INTEGER NOT NULL,          -- positive for TOPUP, negative for DEDUCT, any for RESET
  price_per_token NUMERIC(10,2),        -- set on TOPUP; null for DEDUCT/RESET
  balance_after   INTEGER NOT NULL,     -- running balance snapshot after this txn
  note        TEXT,
  performed_by_id UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Current balance view (derived from transaction log)
CREATE VIEW contractor_token_balances AS
  SELECT
    account_id,
    COALESCE(
      (SELECT balance_after
       FROM contractor_token_transactions t2
       WHERE t2.account_id = t1.account_id
       ORDER BY created_at DESC, id DESC
       LIMIT 1),
      0
    ) AS balance
  FROM (SELECT DISTINCT account_id FROM contractor_token_transactions) t1;
