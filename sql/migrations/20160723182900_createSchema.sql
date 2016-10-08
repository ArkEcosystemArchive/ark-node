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
  "id" VARCHAR(20) PRIMARY KEY,
  "rowId" SERIAL NOT NULL,
  "version" INT NOT NULL,
  "timestamp" INT NOT NULL,
  "height" INT NOT NULL,
  "previousBlock" VARCHAR(20),
  "numberOfTransactions" INT NOT NULL,
  "totalAmount" BIGINT NOT NULL,
  "totalFee" BIGINT NOT NULL,
  "reward" BIGINT NOT NULL,
  "payloadLength" INT NOT NULL,
  "payloadHash" bytea NOT NULL,
  "generatorPublicKey" bytea NOT NULL,
  "blockSignature" bytea NOT NULL,
  FOREIGN KEY("previousBlock")
  REFERENCES "blocks"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "trs"(
  "id" VARCHAR(20) PRIMARY KEY,
  "rowId" SERIAL NOT NULL,
  "blockId" VARCHAR(20) NOT NULL,
  "type" SMALLINT NOT NULL,
  "timestamp" INT NOT NULL,
  "senderPublicKey" bytea NOT NULL,
  "senderId" VARCHAR(22) NOT NULL,
  "recipientId" VARCHAR(22),
  "amount" BIGINT NOT NULL,
  "fee" BIGINT NOT NULL,
  "signature" bytea NOT NULL,
  "signSignature" bytea,
  "requesterPublicKey" bytea,
  "signatures" TEXT,
  FOREIGN KEY("blockId") REFERENCES "blocks"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "signatures"(
  "transactionId" VARCHAR(20) NOT NULL PRIMARY KEY,
  "publicKey" bytea NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES trs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "delegates"(
  "username" VARCHAR(20) NOT NULL,
  "transactionId" VARCHAR(20) NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES "trs"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "votes"(
  "votes" TEXT,
  "transactionId" VARCHAR(20) NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES "trs"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "forks_stat"(
  "delegatePublicKey" bytea NOT NULL,
  "blockTimestamp" INT NOT NULL,
  "blockId" VARCHAR(20) NOT NULL,
  "blockHeight" INT NOT NULL,
  "previousBlock" VARCHAR(20) NOT NULL,
  "cause" INT NOT NULL
);

CREATE TABLE IF NOT EXISTS "multisignatures"(
  "min" INT NOT NULL,
  "lifetime" INT NOT NULL,
  "keysgroup" TEXT NOT NULL,
  "transactionId" VARCHAR(20) NOT NULL,
  FOREIGN KEY("transactionId") REFERENCES "trs"("id") ON DELETE CASCADE
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
CREATE INDEX IF NOT EXISTS "trs_rowId" ON "trs"("rowId");
CREATE INDEX IF NOT EXISTS "trs_block_id" ON "trs"("blockId");
CREATE INDEX IF NOT EXISTS "trs_sender_id" ON "trs"("senderId");
CREATE INDEX IF NOT EXISTS "trs_recipient_id" ON "trs"("recipientId");
CREATE INDEX IF NOT EXISTS "trs_senderPublicKey" ON "trs"("senderPublicKey");
CREATE INDEX IF NOT EXISTS "trs_type" ON "trs"("type");
CREATE INDEX IF NOT EXISTS "trs_timestamp" ON "trs"("timestamp");
CREATE INDEX IF NOT EXISTS "signatures_trs_id" ON "signatures"("transactionId");
CREATE INDEX IF NOT EXISTS "votes_trs_id" ON "votes"("transactionId");
CREATE INDEX IF NOT EXISTS "delegates_trs_id" ON "delegates"("transactionId");
CREATE INDEX IF NOT EXISTS "multisignatures_trs_id" ON "multisignatures"("transactionId");

COMMIT;
