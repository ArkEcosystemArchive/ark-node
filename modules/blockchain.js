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
	cb(null, self);
}

//
//__EVENT__ `onBind`

//
Blockchain.prototype.onBind = function (scope) {
	modules = scope;
};

//
//__EVENT__ `onStartBlockchain`

//
Blockchain.prototype.onStartBlockchain = function(){
	setImmediate(function listenBlockchainState(){
		var state = __private.timestampState();
		if(state.rebuild){
			var timedout=false;
			library.logger.warn("Blockchain rebuild triggered", state);
			library.bus.message("rebuildBlockchain", 3, state, function(err,block){
				// rebuild done
				if(block){
					__private.timestampState(new Date());
					library.logger.warn("Blockchain rebuild done", __private.timestampState());
					if(!timedout){
						timedout=true;
						return setTimeout(listenBlockchainState, 1000);
					}
				}
				// rebuild not done because in sync with network (ie network stale)
				else if(!err){
					library.logger.warn("Rebuild aborted: In sync with observed network", __private.timestampState());
					library.logger.warn("# Network looks stopped");
					if(!timedout){
						timedout=true;
						return setTimeout(listenBlockchainState, 10000);
					}
				}
				// rebuild not done because of internal error
				else{
					library.logger.error("Error rebuilding blockchain. You need to restart the node to get in sync", __private.timestampState());
					if(!timedout){
						timedout=true;
						return setTimeout(listenBlockchainState, 10000);
					}
				}
			});
		}
		else if(state.stale){
			library.logger.debug("Blockchain state", state);

			library.bus.message("downloadBlocks", function(err, lastblock){

			});
			// ok let's try in one more blocktime if still stale
			return setTimeout(listenBlockchainState, 8000);
		}
		else{
			return setTimeout(listenBlockchainState, 1000);
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
		return setTimeout(cleanBlockchain, 10000);
	});
}


//
//__API__ `upsertBlock`

//
Blockchain.prototype.upsertBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    __private.blockchain[block.height]=block;
		delete __private.orphanedBlocks[block.id];
  } else if(__private.blockchain[block.height].id!=block.id){
		__private.orphanedBlocks[block.id]=block;
    error = "upsertBlock - Orphaned Block has been added in the blockchain";
  } else {
    __private.blockchain[block.height]=block;
  }
  return cb && cb(error, __private.blockchain[block.height]);
}

//
//__API__ `isOrphaned`

// Check if the block is orphaned, ie if the blockchain has already received another (different id) block at same height
// It also check for double forgery (different id, same timestamp, same height and same generatorPublicKey)
Blockchain.prototype.isOrphaned = function(block){
	if(__private.blockchain[block.height] && __private.blockchain[block.height].id != block.id){
		if(__private.blockchain[block.height] && __private.blockchain[block.height].generatorPublicKey == block.generatorPublicKey && __private.blockchain[block.height].timestamp == block.timestamp){
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

//
//__API__ `isForked`

// Get a block but can't find the previousBlock in the blockchain
Blockchain.prototype.isForked = function(block){
	var previousBlock = __private.blockchain[""+(block.height-1)];
	return previousBlock && previousBlock.id != block.previousBlock;
}

//
//__API__ `isPresent`

// Check if block is already in blockchain (ie same id) or already found as orphaned
Blockchain.prototype.isPresent = function(block){
	return (__private.blockchain[block.height] && __private.blockchain[block.height].id == block.id) || __private.orphanedBlocks[block.id];
}

//
//__API__ `isReady`

// Check if the blockchain is ready to receive the block (ie received the block at height - 1)
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

//
//__API__ `addBlock`

// Setter the block to the blockchain model, raise error if there is already another one at same height
// Does not check if this is coherent with blockchain (ie previousBlock)
Blockchain.prototype.addBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    __private.blockchain[block.height]=block;
		// if it was previously an orphaned Block, remove it
		delete __private.orphanedBlocks[block.id];
  }
  else if(__private.blockchain[block.height].id != block.id){
		__private.orphanedBlocks[block.id]=block;
    error = "addBlock - Orphaned Block has been added in the blockchain";
  }
	// if same block id don't update
  return cb && cb(error, __private.blockchain[block.height]);
};

// return the previousBlock even if orphaned.
// return null if no previous Block found. Likely a fork.
//
//__API__ `getPreviousBlock`

// get the previous block from the input block, as stored in memory.
// if not found does not check for database, returns undefined.
Blockchain.prototype.getPreviousBlock = function(block){
	var previousBlock = __private.blockchain[""+(block.height - 1)];


	// useful when there is orphaned block
	// if(!previousBlock || previousBlock.id !== block.previousBlock){
	// 	previousBlock = __private.orphanedBlocks[block.previousBlock];
	// }
	return previousBlock;
}

//
//__API__ `removeBlock`

// remove block from blockchain in-memory model
// raise error if not present, or trying to remove a different block at same height
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
  return cb && cb(error, block);
};


//
//__API__ `getBlockAtHeight`

// Getter from in-memory model, can return undefined
Blockchain.prototype.getBlockAtHeight = function(height){
  return __private.blockchain[height];
};


//
//__API__ `getLastBlock`

// return last block on top of the blockchain. Fast access
// The block returned is the last one that has been completely processed
Blockchain.prototype.getLastBlock = function(){
  return __private.lastBlock;
};

// should we have received a new block by now?
// fast
//
//__API__ `isMissingNewBlock`

// return true if there is no new block from lastBlock for over a blocktime
Blockchain.prototype.isMissingNewBlock = function(){
	if(!__private.lastBlock){
		return true;
	}
	else {
		return slots.getTime() - __private.lastBlock.timestamp > constants.blocktime;
	}

};


//
//__API__ `getLastVerifiedBlock`

// return last verified block (it may still be rejected during the process)
// expensive computation checking the whole in memory blockchain for the highest height and verified
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



//
//__API__ `getLastIncludedBlock`

// expensive computation checking the whole in memory blockchain for the highest height
// no check is done if it has been verified of processed
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

//
//__EVENT__ `onDatabaseLoaded`

//
Blockchain.prototype.onDatabaseLoaded = function(lastBlock) {
	lastBlock.processed = true;
	lastBlock.verified = true;
	self.upsertBlock(lastBlock);
	__private.timestampState(new Date());
	__private.lastBlock = lastBlock;
};

//
//__EVENT__ `onBlockRemoved`

//
Blockchain.prototype.onBlockRemoved = function(block) {
	return self.removeBlock(block);
}

//
//__EVENT__ `onBlockReceived`

// Check against in-memory blockchain if the block is ok to be included
// If so, mark the block with block.ready=true
Blockchain.prototype.onBlockReceived = function(block, peer) {
	if(self.isPresent(block)){
		library.logger.debug("Block already received", {id: block.id, height:block.height, peer:peer.string});
		return;
	}

	if(self.isOrphaned(block)){
		__private.orphanedBlocks[block.id]=block;
		// if the forger has a clock drift over a block time, just ignore it
		block.orphaned = block.height==__private.lastBlock.height;
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

//
//__EVENT__ `onBlockForged`

// Check if the forge block is coherent with current in-memory blockchain status
// If so, marks block.ready = true and block.forged = true
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

//
//__EVENT__ `onBlockVerified`

// to update in-memory blockchain when block has been verified
Blockchain.prototype.onBlockVerified = function(block, cb) {
	var error = null;
	if(!__private.blockchain[block.height]){
		error = "Verified block not in blockchain. This is a bug, please do report";
	}
	else{
		__private.blockchain[block.height].verified = true;
	}
}

//
//__EVENT__ `onBlockProcessed`

// to update in-memory blockchain when block has been processed
// and update lastBlock accordingly
Blockchain.prototype.onBlockProcessed = function(block, cb) {

	var error = null;
	if(!__private.blockchain[block.height]){
		error = "Processed block not in blockchain. This is a bug, please do report";
	}
	else{
		__private.blockchain[block.height].processed = true;
		__private.timestampState(new Date());
		if(__private.lastBlock && __private.lastBlock.id == block.previousBlock){
			__private.lastBlock = block;
		}
		else{
			error = "Processed block not consistent with last block on blockchain. This is a bug, please do report";
		}
	}
}

//
//__EVENT__ `onFork`

// Log the event in logs
// TODO: no particular action taken yet
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
