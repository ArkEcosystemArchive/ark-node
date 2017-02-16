/* Create Schema
 *
 */

BEGIN;

/* Tables */
CREATE TABLE IF NOT EXISTS "migrations"(
  "id" VARCHAR(22) NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "blocks"(
  "id" VARCHAR(64) PRIMARY KEY,
  "rowId" SERIAL NOT NULL,
  "version" INT NOT NULL,
  "timestamp" INT NOT NULL,
  "height" INT NOT NULL,
  "previousBlock" VARCHAR(64),
  "numberOfTransactions" INT NOT NULL,
  "totalAmount" BIGINT NOT NULL,
  "totalFee" BIGINT NOT NULL,
  "reward" BIGINT NOT NULL,
  "payloadLength" INT NOT NULL,
  "payloadHash" bytea NOT NULL,
  "generatorPublicKey" bytea NOT NULL,
  "blockSignature" bytea NOT NULL,
  "rawtxs" TEXT NOT NULL,
  FOREIGN KEY("previousBlock")
  REFERENCES "blocks"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "transactions"(
  "id" VARCHAR(64) PRIMARY KEY,
  "rowId" SERIAL NOT NULL,
  "blockId" VARCHAR(20) NOT NULL,
  "type" SMALLINT NOT NULL,
  "timestamp" INT NOT NULL,
  "senderPublicKey" bytea NOT NULL,
  "senderId" VARCHAR(36) NOT NULL,
  "recipientId" VARCHAR(36),
  "amount" BIGINT NOT NULL,
  "fee" BIGINT NOT NULL,
  "signature" bytea NOT NULL,
  "signSignature" bytea,
  "requesterPublicKey" bytea,
  "vendorField" VARCHAR(64),
  "signatures" TEXT,
  "rawasset" TEXT,
  FOREIGN KEY("blockId") REFERENCES "blocks"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "signatures"(
  "transactionId" VARCHAR(64) NOT NULL PRIMARY KEY,
  "publicKey" bytea NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES transactions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "delegates"(
  "username" VARCHAR(20) NOT NULL,
  "transactionId" VARCHAR(64) NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "votes"(
  "votes" TEXT,
  "transactionId" VARCHAR(64) NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "forks_stat"(
  "delegatePublicKey" bytea NOT NULL,
  "blockTimestamp" INT NOT NULL,
  "blockId" VARCHAR(64) NOT NULL,
  "blockHeight" INT NOT NULL,
  "previousBlock" VARCHAR(64) NOT NULL,
  "cause" INT NOT NULL
);

CREATE TABLE IF NOT EXISTS "multisignatures"(
  "min" INT NOT NULL,
  "lifetime" INT NOT NULL,
  "keysgroup" TEXT NOT NULL,
  "transactionId" VARCHAR(64) NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "peers"(
  "id" SERIAL NOT NULL PRIMARY KEY,
  "ip" INET NOT NULL,
  "port" SMALLINT NOT NULL,
  "state" SMALLINT NOT NULL,
  "os" VARCHAR(64),
  "version" VARCHAR(11),
  "clock" BIGINT
);

/* Unique Indexes */
CREATE UNIQUE INDEX IF NOT EXISTS "blocks_height" ON "blocks"("height");
CREATE UNIQUE INDEX IF NOT EXISTS "blocks_previousBlock" ON "blocks"("previousBlock");
CREATE UNIQUE INDEX IF NOT EXISTS "peers_unique" ON "peers"("ip", "port");

/* Indexes */
CREATE INDEX IF NOT EXISTS "blocks_rowId" ON "blocks"("rowId");
CREATE INDEX IF NOT EXISTS "blocks_generator_public_key" ON "blocks"("generatorPublicKey");
CREATE INDEX IF NOT EXISTS "blocks_reward" ON "blocks"("reward");
CREATE INDEX IF NOT EXISTS "blocks_totalFee" ON "blocks"("totalFee");
CREATE INDEX IF NOT EXISTS "blocks_totalAmount" ON "blocks"("totalAmount");
CREATE INDEX IF NOT EXISTS "blocks_numberOfTransactions" ON "blocks"("numberOfTransactions");
CREATE INDEX IF NOT EXISTS "blocks_timestamp" ON "blocks"("timestamp");
CREATE INDEX IF NOT EXISTS "transactions_rowId" ON "transactions"("rowId");
CREATE INDEX IF NOT EXISTS "transactions_block_id" ON "transactions"("blockId");
CREATE INDEX IF NOT EXISTS "transactions_sender_id" ON "transactions"("senderId");
CREATE INDEX IF NOT EXISTS "transactions_recipient_id" ON "transactions"("recipientId");
CREATE INDEX IF NOT EXISTS "transactions_senderPublicKey" ON "transactions"("senderPublicKey");
CREATE INDEX IF NOT EXISTS "transactions_type" ON "transactions"("type");
CREATE INDEX IF NOT EXISTS "transactions_timestamp" ON "transactions"("timestamp");
CREATE INDEX IF NOT EXISTS "signatures_transactions_id" ON "signatures"("transactionId");
CREATE INDEX IF NOT EXISTS "votes_transactions_id" ON "votes"("transactionId");
CREATE INDEX IF NOT EXISTS "delegates_transactions_id" ON "delegates"("transactionId");
CREATE INDEX IF NOT EXISTS "multisignatures_transactions_id" ON "multisignatures"("transactionId");

COMMIT;
