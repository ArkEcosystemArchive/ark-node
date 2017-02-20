'use strict';

var async = require('async');
var constants = require('../helpers/constants.js');
var slots = require('../helpers/slots.js');
var sql = require('../sql/rounds.js');
var crypto = require('crypto');

// Private fields
var modules, library, self, __private = {}, shared = {};


//
// __private.feesByRound = {};
// __private.rewardsByRound = {};
// __private.delegatesByRound = {};
// __private.unFeesByRound = {};
// __private.unRewardsByRound = {};
// __private.unDelegatesByRound = {};

/************************************************************************************
Database Structure:
- a table mem_delegates persisting __private.activedelegates with votes, produced and missed blocks total per round

rounds.tick(block):
- add block.fees to __private.collectedfees[round]
- push block.generatorPublicKey to __private.forgers[round]
- if end of round detected:
  - distribute fees to __private.activedelegates[round]
	- update stats for delegates that have missed block from __private.forgers[round]
	- calculate __private.activedelegates[round+1] and save to database
	- set __private.collectedfees[round+1] = 0
	- round = __private.current++

rounds.backwardTick(block):
- if change to round - 1 detected:
  - sanity check that __private.collectedfees[round] == 0
	- delete __private.activedelegates[round]
	- check we have __private.collectedfees[round-1] and __private.activedelegates[round-1]
	  grab them from database if needed
	- round = __private.current--
- remove block.fees from __private.collectedfees[round]
- pop block.generatorPublicKey from __private.forgers[round]

**************************************************************************************/


__private = {

	// for each round, it stores the active delegates of the round ordered by rank
	// __private.activedelegates[round] = [delegaterank1, delegaterank2, ..., delegaterank51]
	activedelegates: {},

	// for each round, store the forgers, so we can update stats about missing blocks
	// __private.forgers[round] = [forger1, forger2, ..., forgerN]
	forgers: {},

	// for each round, get the memorize the collected fees
	collectedfees: {},

	// current round
	current: 1

};


// Constructor
function Rounds (cb, scope) {
	library = scope;
	self = this;

	return cb(null, self);
}

Rounds.prototype.tick = function(block, cb){
	var round = __private.current;

	// if genesis block, nothing to do about the forger
	// but make sure votes are updated properly to start the round
	if(block.height == 1){
		__private.updateTotalVotesOnDatabase(function(err){
			cb(err, block);
		});
	}

	else{
		// give block rewards + fees to the block forger
		modules.accounts.mergeAccountAndGet({
			publicKey: block.generatorPublicKey,
			balance: block.reward + block.totalFee,
			u_balance: block.reward + block.totalFee,
			producedblocks: 1,
			blockId: block.id,
			round: round
		}, function (err) {
			if(err){
				return cb(err, block);
			}
			else {
				__private.collectedfees[round] += block.totalFee;
				__private.forgers[round].push(block.generatorPublicKey);

				// last block of the round? we prepare next round
				if(self.getRoundFromHeight(block.height+1) == round + 1){
					return __private.changeRoundForward(block, cb);
				}
				else {
					return cb(null, block);
				}
			}
		});
	}
}

Rounds.prototype.backwardTick = function(block, cb){
	var round = __private.current;

	// remove block rewards + fees from the block forger
	modules.accounts.mergeAccountAndGet({
		publicKey: block.generatorPublicKey,
		balance: -(block.reward + block.totalFee),
		u_balance: -(block.reward + block.totalFee),
		producedblocks: -1,
		blockId: block.id,
		round: round
	}, function (err) {
		if(err){
			return cb(err, block);
		}
		else {
			__private.collectedfees[round] -= block.totalFee;
			var generator = __private.forgers[round].pop();
			if(generator != block.generatorPublicKey){
				return cb("Expecting to remove forger "+block.generatorPublicKey+" but removed "+generator, block)
			}
			else {
				return cb(null, block);
			}
		}
	});
};

__private.changeRoundForward = function(block, cb){
	var nextround = __private.current + 1;
	__private.updateTotalVotesOnDatabase(function(err){
		if(err){
			return cb(err, block);
		}
		else {
			__private.generateDelegateList(nextround, function(err, fullactivedelegates){
				if(err){
					return cb(err, block);
				}
				else {
					__private.collectedfees[nextround] = 0;
					__private.forgers[nextround] = [];
					__private.activedelegates[nextround] = fullactivedelegates.map(function(ad){return ad.publicKey});
					__private.updateActiveDelegatesStats(function(err){
						if(err){
							return cb(err, block);
						}
						else{
							__private.saveActiveDelegatesOnDatabase(fullactivedelegates, nextround, function(err){
								if(err){
									return cb(err, block);
								}
								else{
									// we are good to go, let's move to the new round
									__private.current = nextround;
									return cb(null, block);
								}
							});
						}
					});
				}
			});
		}
	});
};


__private.changeRoundBackward = function(block, cb){

};

__private.updateActiveDelegatesStats = function(cb){
	var round = __private.current;
	var activedelegates = __private.activedelegates[round];
	var forgers = __private.forgers[round];
	var forgerStats = {};

	for(var i in forgers){
		if(forgerStats[forgers[i]]){
			forgerStats[forgers[i]].producedblocks++;
		}
		else{
			forgerStats[forgers[i]] = {
				producedblocks:1,
				missedblocks:0
			};
		}
	}

	for(var j in activedelegates){
		if(!forgerStats[activedelegates[j]]){
			forgerStats[activedelegates[j]] = {
				producedblocks:0,
				missedblocks:1
			};
		}
	}

	return __private.updateActiveDelegatesStatsOnDatabase(forgerStats, round, cb);

};

__private.saveActiveDelegatesOnDatabase = function(fullactivedelegates, round, cb){
	library.db.none(sql.saveActiveDelegates(fullactivedelegates), {round: round}).then(cb).catch(cb);
};

__private.updateTotalVotesOnDatabase = function(cb){
	library.db.none(sql.updateTotalVotes).then(cb).catch(cb);
};

__private.updateActiveDelegatesStatsOnDatabase = function(forgerStats, round, cb){
	library.db.none(sql.updateActiveDelegatesStats(forgerStats), {round: round}).then(cb).catch(cb);
};


__private.generateDelegateList = function (round, cb) {
	__private.getKeysSortByVote(function (err, activedelegates) {
		if (err) {
			return cb(err);
		}

		return cb(null, __private.randomizeDelegateList(activedelegates, round));
	});
};

__private.randomizeDelegateList = function (activedelegates, round) {
	// pseudorandom (?!) permutation algorithm.
	// TODO: useless? to improve?
	var seedSource = round.toString();
	var currentSeed = crypto.createHash('sha256').update(seedSource, 'utf8').digest();

	for (var i = 0, delCount = activedelegates.length; i < delCount; i++) {
		for (var x = 0; x < 4 && i < delCount; i++, x++) {
			var newIndex = currentSeed[x] % delCount;
			var b = activedelegates[newIndex];
			activedelegates[newIndex] = activedelegates[i];
			activedelegates[i] = b;
		}
		currentSeed = crypto.createHash('sha256').update(currentSeed).digest();
	}

	return activedelegates;
}

__private.getKeysSortByVote = function (cb) {
	modules.accounts.getAccounts({
		isDelegate: 1,
		sort: {'vote': -1, 'publicKey': 1},
		limit: slots.delegates
	}, ['publicKey', 'vote'], function (err, rows) {
		if (err) {
			return cb(err);
		}
		return setImmediate(cb, null, rows);
	});
};

__private.getCurrentRoundForgers = function(cb) {
	var round = __private.current;
	var lastBlock = modules.blockchain.getLastBlock();
	var firstHeightOfround = (round-1) * slots.delegates;
	library.db.query(sql.getRoundForgers, {minheight: firstHeightOfround, maxheight: lastBlock.height}).then(function(rows){

	}).catch(cb);

}

// height = 1                   ; round = 1
// height = slots.delegates     ; round = 1
// height = slots.delegates + 1 ; round = 2
Rounds.prototype.getRoundFromHeight = function (height) {
	return Math.floor((height-1) / slots.delegates) + 1;
};

Rounds.prototype.getActiveDelegates = function(cb) {
	var round = __private.current;
	// console.log(round);
	// if(__private.activedelegates[round]) console.log(__private.activedelegates[round][0]);
	if(__private.activedelegates[round]){
		return cb(null, __private.activedelegates[round]);
	}
	else {
		// let's get active delegates from database if any
		library.db.query(sql.getActiveDelegates, {round: round}).then(function(rows){
			if(rows.length == constants.activeDelegates){
				rows=__private.randomizeDelegateList(rows, round);
				__private.activedelegates[round]=rows.map(function(row){return row.publicKey;});
				return cb(null, __private.activedelegates[round]);
			}
			// ok maybe we just started node from scratch, so need to generate it.
			else if(modules.blockchain.getLastBlock().height == 1 && round == 1) {
				__private.generateDelegateList(round, function(err, activedelegates){
					if(err){
						return cb(err);
					}
					__private.activedelegates[round] = activedelegates.map(function(ad){return ad.publicKey;});
					__private.saveActiveDelegatesOnDatabase(activedelegates, round, function(){});
					return cb(null, __private.activedelegates[round]);
				});
			}
			else {
				return cb("Can't build active delegates list. Please report. Rebuild form scratch is necessary.");
				//TODO: add here a sql query to drop all mem_ tables
				process.exit(0);
			}
		});
	}
}


// Events
Rounds.prototype.onBind = function (scope) {
	modules = scope;
	__private.forgers["1"]=[];
};

Rounds.prototype.onDatabaseLoaded = function (lastBlock) {

	var round = self.getRoundFromHeight(lastBlock.height);

	__private.current = round;

	self.getActiveDelegates(function(err, delegates){
		//TODO find from forged blocks of the current round
		__private.forgers[round]=__private.forgers[round] || [];
	});


};


Rounds.prototype.cleanup = function (cb) {
	return cb();
};


// Shared

// Export
module.exports = Rounds;
