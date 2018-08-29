BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS "votes_uniq" ON votes ("votes", "transactionId");

COMMIT;
