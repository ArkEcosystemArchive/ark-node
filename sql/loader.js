'use strict';

var LoaderSql = {
  countBlocks: 'SELECT COUNT("rowId")::int FROM blocks',

  countMemAccounts: 'SELECT COUNT(*)::int FROM mem_accounts WHERE "blockId" = (SELECT "id" FROM "blocks" ORDER BY "height" DESC LIMIT 1)',

  resetMemAccounts: [
    'UPDATE mem_accounts SET "u_isDelegate" = "isDelegate", "u_secondSignature" = "secondSignature", "u_username" = "username", "u_balance" = "balance", "u_delegates" = "delegates", "u_multisignatures" = "multisignatures", "u_multimin" = "multimin", "u_multilifetime" = "multilifetime";',
    'DELETE FROM mem_accounts2u_delegates; INSERT INTO mem_accounts2u_delegates SELECT * FROM mem_accounts2delegates;',
    'DELETE FROM mem_accounts2u_multisignatures; INSERT INTO mem_accounts2u_multisignatures SELECT * FROM mem_accounts2multisignatures;',
  ].join(''),

  getOrphanedMemAccounts: 'SELECT a."blockId", b."id" FROM mem_accounts a LEFT OUTER JOIN blocks b ON b."id" = a."blockId" WHERE a."blockId" IS NOT NULL AND a."blockId" != \'0\' AND b."id" IS NULL',

  getDelegates: 'SELECT ENCODE("publicKey", \'hex\') FROM mem_accounts WHERE "isDelegate" = 1',

  getTransactionId: 'SELECT "id" FROM transactions WHERE "id" = ${id}'
};

module.exports = LoaderSql;
