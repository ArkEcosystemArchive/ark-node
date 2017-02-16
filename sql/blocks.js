'use strict';

var BlocksSql = {
  sortFields: [
    'id',
    'timestamp',
    'height',
    'previousBlock',
    'totalAmount',
    'totalFee',
    'reward',
    'numberOfTransactions',
    'generatorPublicKey'
  ],

  getGenesisBlockId: 'SELECT "id" FROM blocks WHERE "id" = ${id}',

  deleteBlock: 'DELETE FROM blocks WHERE "id" = ${id};',

  countList: function (params) {
    return [
      'SELECT COUNT("b_id")::int FROM blocks_list',
      (params.where.length ? 'WHERE ' + params.where.join(' AND ') : '')
    ].filter(Boolean).join(' ');
  },

  list: function (params) {
    return [
      'SELECT * FROM blocks_list',
      (params.where.length ? 'WHERE ' + params.where.join(' AND ') : ''),
      (params.sortField ? 'ORDER BY ' + [params.sortField, params.sortMethod].join(' ') : ''),
      'LIMIT ${limit} OFFSET ${offset}'
    ].filter(Boolean).join(' ');
  },

  getById: 'SELECT * FROM blocks_list WHERE "b_id" = ${id}',

  getIdSequence: 'SELECT (ARRAY_AGG("id" ORDER BY "height" ASC))[1] AS "id", MIN("height") AS "height", CAST("height" / ${delegates} AS INTEGER) + (CASE WHEN "height" % ${activeDelegates} > 0 THEN 1 ELSE 0 END) AS "round" FROM blocks WHERE "height" <= ${height} GROUP BY "round" ORDER BY "height" DESC LIMIT ${limit}',

  getCommonBlock: function (params) {
    return [
      'SELECT COUNT("id")::int FROM blocks WHERE "id" = ${id}',
      (params.previousBlock ? 'AND "previousBlock" = ${previousBlock}' : ''),
      'AND "height" = ${height}'
    ].filter(Boolean).join(' ');
  },

  countByRowId: 'SELECT COUNT("rowId")::int FROM blocks',

  getHeightByLastId: 'SELECT "height" FROM blocks WHERE "id" = ${lastId}',

  loadBlocksData: function (params) {
    var limitPart;

    if (!params.id && !params.lastId) {
      limitPart = 'WHERE height < ${limit}';
    }

    return [
      'SELECT id, version, height, timestamp, "previousBlock", "numberOfTransactions" ,"totalAmount", "totalFee", reward, "payloadLength", encode("payloadHash", \'hex\') as "payloadHash", encode("generatorPublicKey", \'hex\') as "generatorPublicKey",  encode("blockSignature", \'hex\') as "blockSignature", rawtxs::json as transactions from blocks',
      limitPart,
      (params.id || params.lastId ? 'WHERE' : ''),
      (params.id ? 'id = ${id}' : ''),
      (params.id && params.lastId ? ' AND ' : ''),
      (params.lastId ? 'height > ${height} AND height < ${limit}' : ''),
      'ORDER BY height'
    ].filter(Boolean).join(' ');
  },

  loadBlocksOffset: 'SELECT id, version, height, timestamp, "previousBlock", "numberOfTransactions" ,"totalAmount", "totalFee", reward, "payloadLength", encode("payloadHash", \'hex\') as "payloadHash", encode("generatorPublicKey", \'hex\') as "generatorPublicKey",  encode("blockSignature", \'hex\') as "blockSignature", rawtxs::json as transactions from blocks WHERE height >= ${offset} AND height < ${limit} ORDER BY height',

  loadLastBlock: 'SELECT id, version, height, timestamp, "previousBlock", "numberOfTransactions" ,"totalAmount", "totalFee", reward, "payloadLength", encode("payloadHash", \'hex\') as "payloadHash", encode("generatorPublicKey", \'hex\') as "generatorPublicKey",  encode("blockSignature", \'hex\') as "blockSignature", rawtxs::json as transactions from blocks WHERE height = (SELECT MAX("height") FROM blocks)',

  getBlockId: 'SELECT "id" FROM blocks WHERE "id" = ${id}',

  getBlockById: 'SELECT id, version, height, timestamp, "previousBlock", "numberOfTransactions" ,"totalAmount", "totalFee", reward, "payloadLength", encode("payloadHash", \'hex\') as "payloadHash", encode("generatorPublicKey", \'hex\') as "generatorPublicKey",  encode("blockSignature", \'hex\') as "blockSignature", rawtxs::json as transactions from blocks WHERE id = ${id}',

  getTransactionId: 'SELECT "id" FROM transactions WHERE "id" = ${id}',

  simpleDeleteAfterBlock: 'DELETE FROM blocks WHERE "height" >= (SELECT "height" FROM blocks WHERE "id" = ${id});'
};

module.exports = BlocksSql;
