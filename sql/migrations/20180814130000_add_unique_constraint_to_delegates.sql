BEGIN;

CREATE INDEX IF NOT EXISTS "delegates_username_uniq" ON delegates ("username");
CREATE INDEX IF NOT EXISTS "delegates_transactionId_uniq" ON delegates ("transactionId");

COMMIT;
