-- Notifications system
-- Stores in-app notifications and FCM push tokens per user.

CREATE TYPE notification_type AS ENUM (
  'STOCK_RECEIVED',
  'POS_SALE',
  'CONTRACTOR_LABOUR',
  'ORDER_PLACED',
  'EXTRA_RESOLVED',
  'TOKEN_TOPUP'
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB,
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON notifications (user_id, created_at DESC);
CREATE INDEX ON notifications (user_id, read);

-- FCM push tokens: one per user per device/browser
CREATE TABLE fcm_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON fcm_tokens (user_id);
