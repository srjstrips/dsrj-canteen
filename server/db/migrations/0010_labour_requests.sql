-- Contractor Labour Requests
-- Contractor submits N labours for a date; system creates one row per labour.
-- Canteen marks each row served individually. Served rows lock after 24 hours.

CREATE TYPE labour_request_status AS ENUM ('PENDING', 'SERVED');

CREATE TABLE contractor_labour_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES billing_accounts(id),
  entry_date      DATE NOT NULL,
  entry_no        INTEGER NOT NULL,          -- 1, 2, 3... within the batch
  labour_name     TEXT,                      -- optional; null = auto-numbered
  status          labour_request_status NOT NULL DEFAULT 'PENDING',
  served_by_id    UUID REFERENCES users(id),
  served_at       TIMESTAMPTZ,
  token_txn_id    UUID REFERENCES contractor_token_transactions(id),
  created_by_id   UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON contractor_labour_entries (account_id, entry_date);
