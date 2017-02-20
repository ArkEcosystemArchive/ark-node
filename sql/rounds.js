'use strict';

var RoundsSql = {

  saveActiveDelegates: function (activedelegates) {
    var values = activedelegates.map(function(ad){
      return "('"+ad.publicKey+"', (${round})::bigint, ("+ad.vote+")::bigint)";
    }).join(",");

    return 'DELETE FROM mem_delegates where round = (${round})::bigint; INSERT INTO mem_delegates ("publicKey", round, vote) VALUES ' + values;
  },

  getActiveDelegates: 'SELECT * FROM mem_delegates WHERE round = (${round})::bigint ORDER BY vote DESC, "publicKey" ASC;',

  getRoundForgers: 'SELECT ENCODE("generatorPublicKey", \'hex\') as "publicKey" FROM blocks WHERE height > ${minheight} AND height < ${maxheight}+1 ORDER BY height desc;',

  updateActiveDelegatesStats: function (stats) {
    var statements = Object.keys(stats).map(function(pk){
      var stat = stats[pk];
      var statement = 'UPDATE mem_delegates SET ';
      statement += 'missedblocks = '+stat.missedblocks+',';
      statement += 'producedblocks = '+stat.producedblocks;
      statement += ' WHERE "publicKey" = \''+pk+'\' AND round = (${round})::bigint;';
      if(stat.missedblocks > 0){
        statement += 'UPDATE mem_accounts SET ';
        statement += 'missedblocks = missedblocks + ' + stat.missedblocks;
        statement += ' WHERE ENCODE("publicKey", \'hex\') = \''+pk+'\';';
      }
      return statement;
    });

    return statements.join("");
  },

  truncateBlocks: 'DELETE FROM blocks WHERE "height" > (${height})::bigint;',

  updateMissedBlocks: function (backwards) {
    return [
      'UPDATE mem_accounts SET "missedblocks" = "missedblocks"',
      (backwards ? '- 1' : '+ 1'),
      'WHERE "address" IN ($1:csv);'
     ].join(' ');
   },

  getTotalVotes: 'select ARRAY_AGG(a."accountId") as voters, SUM(b.balance) as vote FROM mem_accounts2delegates a, mem_accounts b where a."accountId" = b.address AND a."dependentId" = ${delegate};',

  updateVotes: 'UPDATE mem_accounts SET "vote" = "vote" + (${amount})::bigint WHERE "address" = ${address};',

  updateTotalVotes: 'UPDATE mem_accounts m SET vote = (SELECT COALESCE(SUM(b.balance), 0) as vote FROM mem_accounts2delegates a, mem_accounts b where a."accountId" = b.address AND a."dependentId" = encode(m."publicKey", \'hex\')) WHERE m."isDelegate" = 1;',

  updateBlockId: 'UPDATE mem_accounts SET "blockId" = ${newId} WHERE "blockId" = ${oldId};'

};

module.exports = RoundsSql;
