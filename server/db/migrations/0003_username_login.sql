-- Replace email-based login with username-based login.
-- The existing unique index on the column is preserved by the rename, so
-- usernames stay unique. Existing users are backfilled from the local part of
-- their email (e.g. admin@dsrj.local -> admin) so current accounts keep working.

ALTER TABLE users RENAME COLUMN email TO username;
UPDATE users SET username = split_part(username, '@', 1);
