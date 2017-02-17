'use strict';

var RoundsSql = {

  saveActiveDelegates: function (activedelegates) {
    var values = activedelegates.map(function(ad){
      return "('"+ad.publicKey+"', (${round})::bigint, ("+ad.vote+")::bigint)";
    }).join(",");

    return 'INSERT INTO mem_delegates ("publicKey", round, vote) VALUES ' + values;
  },

  getActiveDelegates: 'SELECT * FROM mem_delegates WHERE round = (${round})::bigint ORDER BY vote DESC, "publicKey" ASC;',

  updateActiveDelegatesStats: function (stats) {
    var statements = Object.keys(stats).map(function(pk){
      var stat = stats[pk];
      var statement = 'UPDATE mem_delegates SET ';
      statement += 'missedblocks = '+stat.missedblocks+',';
      statement += 'producedblocks = '+stat.producedblocks;
      statement += ' WHERE "publicKey" = \''+pk+'\' AND round = (${round})::bigint;';
      return statement;
    });

    return statements.join("");
  },

  flush: 'DELETE FROM mem_round WHERE "round" = (${round})::bigint;',

  truncateBlocks: 'DELETE FROM blocks WHERE "height" > (${height})::bigint;',

  updateMissedBlocks: function (backwards) {
    return [
      'UPDATE mem_accounts SET "missedblocks" = "missedblocks"',
      (backwards ? '- 1' : '+ 1'),
      'WHERE "address" IN ($1:csv);'
     ].join(' ');
   },

  getVotes: 'SELECT d."delegate", d."amount" FROM (SELECT m."delegate", SUM(m."amount") AS "amount", "round" FROM mem_round m GROUP BY m."delegate", m."round") AS d WHERE "round" = (${round})::bigint',

  getTotalVotes: 'select ARRAY_AGG(a."accountId") as voters, SUM(b.balance) as vote FROM mem_accounts2delegates a, mem_accounts b where a."accountId" = b.address AND a."dependentId" = ${delegate};',

  updateVotes: 'UPDATE mem_accounts SET "vote" = "vote" + (${amount})::bigint WHERE "address" = ${address};',

  updateTotalVotes: 'UPDATE mem_accounts m SET vote = (SELECT COALESCE(SUM(b.balance), 0) as vote FROM mem_accounts2delegates a, mem_accounts b where a."accountId" = b.address AND a."dependentId" = encode(m."publicKey", \'hex\')) WHERE m."isDelegate" = 1;',

  updateBlockId: 'UPDATE mem_accounts SET "blockId" = ${newId} WHERE "blockId" = ${oldId};',

  summedRound: 'SELECT SUM(b."totalFee")::bigint AS "fees", ARRAY_AGG(b."reward") AS "rewards", ARRAY_AGG(ENCODE(b."generatorPublicKey", \'hex\')) AS "delegates" FROM blocks b WHERE (SELECT (CAST(b."height" / ${activeDelegates} AS INTEGER) + (CASE WHEN b."height" % ${activeDelegates} > 0 THEN 1 ELSE 0 END))) = ${round}'
};

module.exports = RoundsSql;
