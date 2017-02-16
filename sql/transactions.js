'use strict';

var TransactionsSql = {
  sortFields: [
    'id',
    'blockId',
    'amount',
    'fee',
    'type',
    'timestamp',
    'senderPublicKey',
    'senderId',
    'recipientId',
    'confirmations',
    'height'
  ],

  countById: 'SELECT COUNT("id")::int AS "count" FROM transactions WHERE "id" = ${id}',

  countList: function (params) {
    return [
      'SELECT COUNT("id") FROM transactions',
      (params.where.length || params.owner ? 'WHERE' : ''),
      (params.where.length ? '(' + params.where.join(' OR ') + ')' : ''),
      (params.where.length && params.owner ? ' AND ' + params.owner : params.owner)
    ].filter(Boolean).join(' ');
  },

  list: function (params) {
    // Need to fix 'or' or 'and' in query
    return [
      'SELECT id, "blockId", type, timestamp, amount, fee, "vendorField", "senderId", "recipientId", encode("senderPublicKey", \'hex\') as "senderPublicKey", encode("requesterPublicKey", \'hex\') as "requesterPublicKey",  encode("signature", \'hex\') as "signature", encode("signSignature", \'hex\') as "signSignature", signatures::json as signatures, rawasset::json as asset FROM transactions',
      (params.where.length || params.owner ? 'WHERE' : ''),
      (params.where.length ? '(' + params.where.join(' OR ') + ')' : ''),
      (params.where.length && params.owner ? ' AND ' + params.owner : params.owner),
      (params.sortField ? 'ORDER BY ' + [params.sortField, params.sortMethod].join(' ') : ''),
      'LIMIT ${limit} OFFSET ${offset}'
    ].filter(Boolean).join(' ');
  },

  getById: 'SELECT id, "blockId", type, timestamp, amount, fee, "vendorField", "senderId", "recipientId", encode("senderPublicKey", \'hex\') as "senderPublicKey", encode("requesterPublicKey", \'hex\') as "requesterPublicKey",  encode("signature", \'hex\') as "signature", encode("signSignature", \'hex\') as "signSignature", signatures::json as signatures, rawasset::json as asset FROM transactions WHERE id = ${id}',

  getVotesById: 'SELECT * FROM votes WHERE "transactionId" = ${id}'

};

module.exports = TransactionsSql;
