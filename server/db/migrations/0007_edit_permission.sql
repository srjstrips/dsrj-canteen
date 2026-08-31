-- Per-user permission to edit/delete OLD entries (beyond the 24-hour window).
-- Normal users may only edit their entries within 24h of creation; a user with
-- can_edit_old = TRUE (granted by an admin) bypasses that limit. ADMIN always can.
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_old BOOLEAN NOT NULL DEFAULT FALSE;
