'use strict';

var async = require('async');
var constants = require('../helpers/constants.js');
var slots = require('../helpers/slots.js');

var self, library, modules;

var __private = {
	// Estimation of clock drift from network in seconds
	clockdrift: 0,

	// Indexed by height
	blockchain: {},

	// Indexed by height all blocks considered as orphaned
	orphanedBlocks: {},

	// List of blocks received higher than lastBlock.height that can't be processed
	// Indicator of being forked from network
	// To use carefully as it can be a vector of attack
	// Indexed by height
	forkedChainBlocks: {},

	// Last block processed in the blockchain
	lastBlock: {height: 0}
};


// Constructor
function Blockchain (cb, scope) {
	library = scope;
	self = this;
	setImmediate(cb, null, self);
}

Blockchain.prototype.onBind = function (scope) {
	modules = scope;
};

Blockchain.prototype.onStartBlockchain = function(){
	setImmediate(function listenBlockchainState(){
		var state = __private.timestampState();
		if(state.rebuild){
			var timedout=false;
			library.logger.warn("Blockchain rebuild triggered", state);
			library.bus.message("rebuildBlockchain", 3, state, function(err,block){
				if(block){ // rebuild done
					__private.timestampState(new Date());
					library.logger.warn("Blockchain rebuild done", __private.timestampState());
					if(!timedout){
						timedout=true;
						setTimeout(listenBlockchainState, 1000);
					}
				}
				else if(!err){ // rebuild not done because in sync with network (ie network stale)
					library.logger.warn("Rebuild aborted: In sync with observed network", __private.timestampState());
					library.logger.warn("# Network looks stopped");
					if(!timedout){
						timedout=true;
						setTimeout(listenBlockchainState, 10000);
					}
				}
				else{
					library.logger.error("Error rebuilding blockchain. You need to restart the node to get in sync", __private.timestampState());
					if(!timedout){
						timedout=true;
						setTimeout(listenBlockchainState, 10000);
					}
				}
			});
		}
		else if(state.stale){
			library.logger.debug("Blockchain state", state);
			//library.logger.debug("mem blockchain size", Object.keys(__private.blockchain).length);
			library.bus.message("downloadBlocks", function(err, lastblock){
				//console.log(lastblock.height);
				// TODO: see how the download went for further action
			});
			// ok let's try in one more blocktime if still stale
			setTimeout(listenBlockchainState, 8000);
		}
		else{
			setTimeout(listenBlockchainState, 1000);
		}
	});

	setImmediate(function cleanBlockchain(){
		var height = __private.lastBlock.height;
		var blockremoved = __private.blockchain[height-200];
		library.logger.debug("Removing from memory blockchain blocks with height under", height-200);
		while(blockremoved){
			delete __private.blockchain[blockremoved.height];
			blockremoved = __private.blockchain[""+(blockremoved.height-1)];
		}
		setTimeout(cleanBlockchain, 10000);
	});

	// setTimeout(function fakeRebuild(){
	// 	var state = __private.timestampState();
	// 	library.logger.warn("Blockchain rebuild triggered", state);
	// 	//console.log(Object.keys(__private.blockchain));
	// 	library.bus.message("rebuildBlockchain", 100, state, function(err,block){
	// 		setTimeout(fakeRebuild, 10000);
	// 	});
	// }, 10000);
}


Blockchain.prototype.upsertBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    __private.blockchain[block.height]=block;
  } else if(__private.blockchain[block.height].id!=block.id){
		__private.orphanedBlocks[block.id]=block;
    error = "upsertBlock - Orphaned Block has been added in the blockchain";
  } else {
    __private.blockchain[block.height]=block;
  }
  return cb && setImmediate(cb, error, __private.blockchain[block.height]);
}

Blockchain.prototype.isOrphaned = function(block){
	if(__private.blockchain[block.height] && __private.blockchain[block.height].id != block.id){
		if(__private.blockchain[block.height] && __private.blockchain[block.height].generatorPublicKey == block.generatorPublicKey){
			modules.accounts.getAccount({publicKey:block.generatorPublicKey}, function(err, delegate){
				library.logger.warn("Double forgery", {id: block.id, generator:block.generatorPublicKey, username: delegate.username, height:block.height});
			});
		}
		return true;
	}
	else {
		return false;
	}
}

Blockchain.prototype.isForked = function(block){
	var previousBlock = __private.blockchain[""+(block.height-1)];
	return previousBlock && previousBlock.id != block.previousBlock;
}

Blockchain.prototype.isPresent = function(block){
	//console.log(__private.blockchain);
	return (__private.blockchain[block.height] && __private.blockchain[block.height].id == block.id) || __private.orphanedBlocks[block.id];
}

Blockchain.prototype.isReady = function(block){
	var ready = __private.lastBlock.height == block.height - 1;
	if(ready){
		return true;
	}
	else{
		__private.forkedChainBlocks[block.height]=block;
		return false;
	}
}

Blockchain.prototype.addBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    __private.blockchain[block.height]=block;
  }
  else if(__private.blockchain[block.height].id != block.id){
		__private.orphanedBlocks[block.id]=block;
    error = "addBlock - Orphaned Block has been added in the blockchain";
  }
	// if same block id don't update
  return cb && setImmediate(cb, error, __private.blockchain[block.height]);
};

// return the previousBlock even if orphaned.
// return null if no previous Block found. Likely a fork.
Blockchain.prototype.getPreviousBlock = function(block){
	var previousBlock = __private.blockchain[""+(block.height - 1)];
	//console.log(block.height);
	//console.log(__private.blockchain);
	// useful when there is orphaned block
	// if(!previousBlock || previousBlock.id !== block.previousBlock){
	// 	previousBlock = __private.orphanedBlocks[block.previousBlock];
	// }
	return previousBlock;
}

Blockchain.prototype.removeBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    error = "removeBlock - Block already removed from blockchain"
  } else if(__private.blockchain[block.height].id!=block.id){
    error = "removeBlock - Block has been replaced in the blockchain";
  } else {
		if(__private.lastBlock.id == __private.blockchain[block.height].id){
			__private.lastBlock = __private.blockchain[""+(block.height-1)];
		}
    delete __private.blockchain[block.height];
		// TODO: reuse orphaned blocks sending a message to stop rebuild
		// if one of the orphaned block is at the origin (ie block.previousBlock == orphanedBlock.previousBlock)
		delete __private.orphanedBlocks[block.id];
  }
  return cb && setImmediate(cb, error, block);
};

Blockchain.prototype.getBlockAtHeight = function(height){
  return __private.blockchain[height];
};

// return the last processed block on top of blockchain
// fast
Blockchain.prototype.getLastBlock = function(){
  return __private.lastBlock;
};

// should we have received a new block by now?
// fast
Blockchain.prototype.isMissingNewBlock = function(){
	if(!__private.lastBlock){
		return true;
	}
	else {
		return slots.getTime() - __private.lastBlock.timestamp > constants.blocktime;
	}

};

// expensive
Blockchain.prototype.getLastVerifiedBlock = function(){
  var lastBlock=null;
  for(var height in __private.blockchain){
    if(!lastBlock){
      lastBlock = __private.blockchain[height];
    }
    else if(parseInt(height)>lastBlock.height && __private.blockchain[height].verified){
      lastBlock = __private.blockchain[height];
    }
  }
  return lastBlock;
};

// expensive
Blockchain.prototype.getLastIncludedBlock = function(){
  var lastBlock=null;
  for(var height in __private.blockchain){
    if(!lastBlock){
      lastBlock = __private.blockchain[height];
    }
    else if(parseInt(height)>lastBlock.height){
      lastBlock = __private.blockchain[height];
    }
  }
  return lastBlock;
};

// to deprecate, kept for info
// Blockchain.prototype.onReceiveBlock = function (block, peer) {
//
// 	//we make sure we process one block at a time
// 	library.managementSequence.add(function (cb) {
// 		var lastBlock = self.getLastBlock();
//
// 		if (block.previousBlock === lastBlock.id && lastBlock.height + 1 === block.height) {
// 			library.logger.info([
// 				'Received new block id:', block.id,
// 				'height:', block.height,
// 				'round:',  modules.rounds.getRoundFromHeight(block.height),
// 				'slot:', slots.getSlotNumber(block.timestamp),
// 				'reward:', block.reward,
// 				'transactions', block.numberOfTransactions
// 			].join(' '));
//
// 			self.lastReceipt(new Date());
// 			//library.logger.debug("Received block", block);
// 			//RECEIVED full block?
// 			if(block.numberOfTransactions==0 || block.numberOfTransactions==block.transactions.length){
// 				library.logger.debug("processing full block",block.id);
// 				self.processBlock(block, cb);
// 			}
// 			else{
// 				//let's download the full block transactions
// 				modules.transport.getFromPeer(peer, {
// 					 method: 'GET',
// 					 api: '/block?id=' + block.id
// 				 }, function (err, res) {
// 					 if (err || res.body.error) {
// 						 library.logger.debug('Cannot get block', block.id);
// 						 return setImmediate(cb, err);
// 					 }
// 					 library.logger.debug("calling "+peer.ip+":"+peer.port+"/peer/block?id=" + block.id);
// 					 library.logger.debug("received transactions",res.body);
//
// 					 if(res.body.transactions.length==block.numberOfTransactions){
// 						 block.transactions=res.body.transactions
// 						 self.processBlock(block, cb);
// 					 }
// 					 else{
// 						 return setImmediate(cb, "Block transactions could not be downloaded.");
// 					 }
// 				 }
// 			 );
// 			}
// 		} else if (block.previousBlock !== lastBlock.id && lastBlock.height + 1 === block.height) {
// 			// Fork: consecutive height but different previous block id
// 			library.bus.message("fork",block, 1);
// 			// Uncle forging: decide winning chain
// 			// -> winning chain is smallest block id (comparing with lexicographic order)
// 			if(block.previousBlock < lastBlock.id){
// 				// we should verify the block first:
// 				// - forging delegate is legit
// 				modules.delegates.validateBlockSlot(block, function (err) {
// 					if (err) {
// 						library.logger.warn("received block is not forged by a legit delegate", err);
// 						return setImmediate(cb, err);
// 					}
// 					modules.loader.triggerBlockRemoval(1);
// 					return  setImmediate(cb);
// 				});
// 			}
// 			else {
// 				// we are on winning chain, ignoring block
// 				return setImmediate(cb);
// 			}
// 		} else if (block.previousBlock === lastBlock.previousBlock && block.height === lastBlock.height && block.id !== lastBlock.id) {
// 			// Fork: Same height and previous block id, but different block id
// 			library.logger.info("last block", lastBlock);
// 			library.logger.info("received block", block);
// 			library.bus.message("fork", block, 5);
//
// 			// Orphan Block: Decide winning branch
// 			// -> winning chain is smallest block id (comparing with lexicographic order)
// 			if(block.id < lastBlock.id){
// 				// we should verify the block first:
// 				// - forging delegate is legit
// 				modules.delegates.validateBlockSlot(block, function (err) {
// 					if (err) {
// 						library.logger.warn("received block is not forged by a legit delegate", err);
// 						return setImmediate(cb, err);
// 					}
// 					modules.loader.triggerBlockRemoval(1);
// 					return  setImmediate(cb);
// 				});
// 			}
// 			else {
// 				// we are on winning chain, ignoring block
// 				return  setImmediate(cb);
// 			}
// 		} else {
// 			//Dunno what this block coming from, ignoring block
// 			return setImmediate(cb);
// 		}
// 	});
// };

Blockchain.prototype.onDatabaseLoaded = function(lastBlock) {
	lastBlock.processed = true;
	lastBlock.verified = true;
	self.upsertBlock(lastBlock);
	__private.timestampState(new Date());
	__private.lastBlock = lastBlock;
};

Blockchain.prototype.onBlockRemoved = function(block) {
	return self.removeBlock(block);
}

Blockchain.prototype.onBlockReceived = function(block, peer) {
	if(self.isPresent(block)){
		library.logger.debug("Block already received", {id: block.id, height:block.height, peer:peer.string});
		return;
	}

	if(self.isOrphaned(block)){
		__private.orphanedBlocks[block.id]=block;
		block.orphaned=true;
		library.logger.info("Orphaned block received", {id: block.id, height:block.height, peer:peer.string});
		return;
	}

	if(self.isForked(block)){
		__private.orphanedBlocks[block.id]=block;
		var previousBlock = self.getPreviousBlock(block);
		library.logger.info("Forked block received", {id: block.id, height:block.height, previousBlock: block.previousBlock, previousBlockchainBlock: previousBlock.id, peer:peer.string});
		return;
	}

	if(!self.isReady(block)){
		var lastBlock = self.getLastBlock();
		library.logger.info("Blockchain not ready to receive block", {id: block.id, height:block.height, lastBlockHeight: lastBlock.height, peer:peer.string});
		return;
	}

	block.ready = true;

	return self.addBlock(block);

};

Blockchain.prototype.onBlockForged = function(block) {
	if(self.isPresent(block)){
		modules.accounts.getAccount({publicKey:block.generatorPublicKey}, function(err, delegate){
			library.logger.error("Double forgery - Same block - please disable delegate on one node", {id: block.id, generator:block.generatorPublicKey, username: delegate.username, height:block.height});
		});
		return;
	}

	if(self.isOrphaned(block)){
		modules.accounts.getAccount({publicKey:block.generatorPublicKey}, function(err, delegate){
			library.logger.error("Double forgery - Orphaned block - please disable delegate on one node", {id: block.id, generator:block.generatorPublicKey, username: delegate.username, height:block.height});
		});
		return;
	}

	if(self.isForked(block)){
		var previousBlock = self.getPreviousBlock(block);
		modules.accounts.getAccount({publicKey:block.generatorPublicKey}, function(err, delegate){
			library.logger.error("Double forgery - Forked block - please disable delegate on one node", {id: block.id, generator:block.generatorPublicKey, username: delegate.username, height:block.height, previousBlock: block.previousBlock, previousBlockchainBlock: previousBlock.id});
		});
		return;
	}

	block.ready = true;
	block.verified = true;
	block.forged = true;
  block.processed = false;
	block.broadcast = true;
	library.logger.info("Adding forged to blockchain", block.id);
  self.addBlock(block);
}

Blockchain.prototype.onBlockVerified = function(block, cb) {
	var error = null;
	if(!__private.blockchain[block.height]){
		error = "Verified block not in blockchain. This is a bug, please do report";
	}
	else{
		__private.blockchain[block.height].verified = true;
	}
}

Blockchain.prototype.onBlockProcessed = function(block, cb) {
	//console.log(block);
	var error = null;
	if(!__private.blockchain[block.height]){
		error = "Processed block not in blockchain. This is a bug, please do report";
	}
	else{
		__private.blockchain[block.height].processed = true;
		__private.timestampState(new Date());
		if(__private.lastBlock.id == block.previousBlock){
			__private.lastBlock = block;
		}
		else{
			error = "Processed block not consistent with last block on blockchain. This is a bug, please do report";
		}
	}
}

Blockchain.prototype.onFork = function (block, cause) {
	library.logger.info('Fork', {
		delegate: block.generatorPublicKey,
		block: {
			id: block.id,
			timestamp: block.timestamp,
			height: block.height,
			previousBlock: block.previousBlock
		},
		cause: cause
	});
	//library.logger.debug('Forked block',block);
};

// manage the internal state logic
__private.timestampState = function (lastReceipt) {
	if (!__private.lastReceipt) {
		__private.lastReceipt = {
			date: new Date()
		};
	}
	if(lastReceipt){
		__private.lastReceipt.date = lastReceipt;
	}

	var timeNow = new Date().getTime();
	__private.lastReceipt.secondsAgo = Math.floor((timeNow -  __private.lastReceipt.date.getTime()) / 1000);
	if(modules.delegates.isActiveDelegate()){
		__private.lastReceipt.stale = __private.lastReceipt.secondsAgo > 10;
		__private.lastReceipt.rebuild = __private.lastReceipt.secondsAgo > 60;
	}

	else if(modules.delegates.isForging()){
		__private.lastReceipt.stale = __private.lastReceipt.secondsAgo > 30;
		__private.lastReceipt.rebuild = __private.lastReceipt.secondsAgo > 100;
	}

	else {
		__private.lastReceipt.stale = __private.lastReceipt.secondsAgo > 60;
		__private.lastReceipt.rebuild = __private.lastReceipt.secondsAgo > 200;
	}

	if(__private.lastBlock.height < 52){
		__private.lastReceipt.rebuild = false;
	}

	__private.lastReceipt.height = __private.lastBlock.height;

	return __private.lastReceipt;
};

module.exports = Blockchain;
