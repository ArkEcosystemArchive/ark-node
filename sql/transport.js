'use strict';

var TransportSql = {
  getCommonBlock: 'SELECT MAX("height") AS "height", "id", "previousBlock", "timestamp" FROM blocks WHERE "id" IN ($1:csv) GROUP BY "id" ORDER BY "height" DESC',
  getBlockTransactions: 'SELECT * from trs_list WHERE "t_blockId" = ${block_id}',
  blockList: 'SELECT id, version, height, timestamp, "previousBlock", "numberOfTransactions" ,"totalAmount", "totalFee", reward, "payloadLength", encode("payloadHash", \'hex\') as "payloadHash", encode("generatorPublicKey", \'hex\') as "generatorPublicKey",  encode("blockSignature", \'hex\') as "blockSignature", rawtxs::json as transactions from blocks WHERE "height" > ${lastBlockHeight} ORDER BY "height" ASC LIMIT ${limit}',
  block: 'SELECT id, version, height, timestamp, "previousBlock", "numberOfTransactions" ,"totalAmount", "totalFee", reward, "payloadLength", encode("payloadHash", \'hex\') as "payloadHash", encode("generatorPublicKey", \'hex\') as "generatorPublicKey",  encode("blockSignature", \'hex\') as "blockSignature", rawtxs::json as transactions from blocks WHERE id = ${id}'
};

module.exports = TransportSql;
