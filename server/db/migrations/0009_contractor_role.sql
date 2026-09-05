-- Add CONTRACTOR as a login role so contractor firms can log in and
-- view their own token balance and transaction history.
ALTER TYPE role_enum ADD VALUE IF NOT EXISTS 'CONTRACTOR';

-- Link a contractor user to their billing account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES billing_accounts(id);
