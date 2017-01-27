'use strict';

var async = require('async');
var Sequence = require('../helpers/sequence.js');


var self, library, modules;

var __private = {};
__private.blockchain={};

// Constructor
function NodeManager (cb, scope) {
	library = scope;
	self = this;
	setImmediate(cb, null, self);
}

NodeManager.prototype.onBind = function (scope) {
	modules = scope;
};

//Main entry point of the node app
NodeManager.prototype.startApp = function(){
	library.logger.info("# Starting App");
  library.bus.message('loadDatabase');
}

NodeManager.prototype.updateBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    error = "updateBlock - Block already removed from blockchain"
  } else if(__private.blockchain[block.height].id!=block.id){
    error = "updateBlock - Block has been replaced in the blockchain";
  } else {
    __private.blockchain[block.height]=block;
  }
  return setImmediate(cb, error, __private.blockchain[block.height]);
}

NodeManager.prototype.addToBlockchain = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    __private.blockchain[block.height]=block;
  }
  else if(__private.blockchain[block.height].id != block.id){
    error = "addToBlockchain - Block has been replaced in the blockchain";
  }
  return cb && setImmediate(cb, error, __private.blockchain[block.height]);
};

NodeManager.prototype.removeFromBlockchain = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    error = "removeFromBlockchain - Block already removed from blockchain"
  } else if(__private.blockchain[block.height].id!=block.id){
    error = "removeFromBlockchain - Block has been replaced in the blockchain";
  } else {
    delete __private.blockchain[block.height];
  }
  return setImmediate(cb, error, block);
};

NodeManager.prototype.getBlockAtHeight = function(height){
  return __private.blockchain[height];
};

NodeManager.prototype.getLastBlock = function(){
  var lastBlock=null;
  for(var height in __private.blockchain){
    if(!lastBlock){
      lastBlock = __private.blockchain[height];
    }
    else if(parseInt(height)>lastBlock.height && __private.blockchain[height].processed){
      lastBlock = __private.blockchain[height];
    }
  }
  return lastBlock;
};

NodeManager.prototype.getLastVerifiedBlock = function(){
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

NodeManager.prototype.getLastIncludedBlock = function(){
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


NodeManager.prototype.onDatabaseLoaded = function(lastBlock) {
	lastBlock.processed = true;
	lastBlock.verified = true;
	self.addToBlockchain(lastBlock);
  library.bus.message('loadDelegates');
	library.bus.message('startTransactionPool');
  library.bus.message('attachNetworkApi');
};

NodeManager.prototype.onNetworkApiAttached = function(){
  library.bus.message('updatePeers');
}

NodeManager.prototype.onDelegatesLoaded = function(keypairs) {
  var numberOfDelegates=Object.keys(keypairs).length;
  if(numberOfDelegates>0){
    __private.keypairs=keypairs;
    library.logger.info("# Loaded "+numberOfDelegates+" delegate(s). Started as a forging node");
    library.bus.message('startForging');
    if(library.config.api.mount){
      library.bus.message('attachPublicApi');
    }
  }
  else{
    library.logger.info("# Started as a relay node");
		if(library.config.api.mount){
      library.bus.message('attachPublicApi');
    }
  }
};

NodeManager.prototype.onPeersUpdated = function() {
	library.bus.message('observeNetwork');
};

NodeManager.prototype.onNetworkObserved = function(){
	library.bus.message('downloadBlocks');
}

NodeManager.prototype.onBlocksDownloaded = function(lastBlock) {
  self.addToBlockchain(lastBlock, function(err, block){
    if(err){
      library.logger.error(err, block);
    }
    else{
      library.logger.debug("Last block height downloaded", block.height);
    }
  });
	// listening to internal state
	//library.bus.message('verifyBlock', block);
};



NodeManager.prototype.onReceiveBlock = function (block, peer) {
	//we make sure we process one block at a time
	library.sequence.add(function (cb) {
		var lastBlock = modules.nodeManager.getLastBlock();

		if (block.previousBlock === lastBlock.id && lastBlock.height + 1 === block.height) {
			library.logger.info([
				'Received new block id:', block.id,
				'height:', block.height,
				'round:',  modules.rounds.calc(block.height),
				'slot:', slots.getSlotNumber(block.timestamp),
				'reward:', block.reward,
				'transactions', block.numberOfTransactions
			].join(' '));

			self.lastReceipt(new Date());
			//library.logger.debug("Received block", block);
			//RECEIVED full block?
			if(block.numberOfTransactions==0 || block.numberOfTransactions==block.transactions.length){
				library.logger.debug("processing full block",block.id);
				self.processBlock(block, cb);
			}
			else{
				//let's download the full block transactions
				modules.transport.getFromPeer(peer, {
					 method: 'GET',
					 api: '/block?id=' + block.id
				 }, function (err, res) {
					 if (err || res.body.error) {
						 library.logger.debug('Cannot get block', block.id);
						 return setImmediate(cb, err);
					 }
					 library.logger.debug("calling "+peer.ip+":"+peer.port+"/peer/block?id=" + block.id);
					 library.logger.debug("received transactions",res.body);

					 if(res.body.transactions.length==block.numberOfTransactions){
						 block.transactions=res.body.transactions
						 self.processBlock(block, cb);
					 }
					 else{
						 return setImmediate(cb, "Block transactions could not be downloaded.");
					 }
				 }
			 );
			}
		} else if (block.previousBlock !== lastBlock.id && lastBlock.height + 1 === block.height) {
			// Fork: consecutive height but different previous block id
			library.bus.message("fork",block, 1);
			// Uncle forging: decide winning chain
			// -> winning chain is smallest block id (comparing with lexicographic order)
			if(block.previousBlock < lastBlock.id){
				// we should verify the block first:
				// - forging delegate is legit
				modules.delegates.validateBlockSlot(block, function (err) {
					if (err) {
						library.logger.warn("received block is not forged by a legit delegate", err);
						return setImmediate(cb, err);
					}
					modules.loader.triggerBlockRemoval(1);
					return  setImmediate(cb);
				});
			}
			else {
				// we are on winning chain, ignoring block
				return setImmediate(cb);
			}
		} else if (block.previousBlock === lastBlock.previousBlock && block.height === lastBlock.height && block.id !== lastBlock.id) {
			// Fork: Same height and previous block id, but different block id
			library.logger.info("last block", lastBlock);
			library.logger.info("received block", block);
			library.bus.message("fork", block, 5);

			// Orphan Block: Decide winning branch
			// -> winning chain is smallest block id (comparing with lexicographic order)
			if(block.id < lastBlock.id){
				// we should verify the block first:
				// - forging delegate is legit
				modules.delegates.validateBlockSlot(block, function (err) {
					if (err) {
						library.logger.warn("received block is not forged by a legit delegate", err);
						return setImmediate(cb, err);
					}
					modules.loader.triggerBlockRemoval(1);
					return  setImmediate(cb);
				});
			}
			else {
				// we are on winning chain, ignoring block
				return  setImmediate(cb);
			}
		} else {
			//Dunno what this block coming from, ignoring block
			return setImmediate(cb);
		}
	});
};

NodeManager.prototype.onBlocksReceived = function(blocks, peer, cb) {
	async.eachSeries(blocks, function (block, cb) {
		block.reward=parseInt(block.reward);
		block.totalAmount=parseInt(block.totalAmount);
		block.totalFee=parseInt(block.totalFee);
		block.verified = false;
	  block.processed = false;
		if(block.height%1000 == 0){
			library.logger.info("Processsing block height", block.height);
		}
		self.addToBlockchain(block, function(err, block){
			if(err){
				setImmediate(cb, err, block);
			}
			else{
				library.bus.message('verifyBlock', block, cb);
			}
		});
	}, function(err, block){
		if(err){
			library.logger.error(err, block);
		}
		else{
			library.bus.message("downloadBlocks");
			cb && setImmediate(cb, null, block);
		}
	});
}

NodeManager.prototype.onBlockRemoved = function(block, cb) {
	self.removeFromBlockchain(block, cb);
};

NodeManager.prototype.onBlockReceived = function(block, peer) {
	var lastBlock = self.getLastBlock();
  if(!__private.blockchain[""+(block.height-1)]){
    library.logger.info("Blockchain is not complete", block);
		// to prevent from spam we accept only blocks close to top of blockchain
		if((lastBlock.height < block.height) && (block.height-lastBlock.height < 5)){
	    block.verified=false;
	    block.processed=false;
	    block.broadcast=true;
	    self.addToBlockchain(block);
		}
  }

  var myblock = __private.blockchain[block.height];
  if(myblock){
    // FORK
    if(block.id != myblock.id){
      if(myblock.verified){ // likely already in database

      }
      else { // we have time to decide who wins

      }
    }
		else{
			library.logger.debug("Block already in Blockchain", block.id);
		}

  } else if(block.previousBlock == lastBlock.id){ //all clear
    block.verified=false;
    block.processed=false;
    block.broadcast=true;
		//RECEIVED full block?
		if(block.numberOfTransactions==0){
			library.logger.debug("processing full block", block.id);
	    self.addToBlockchain(block, function(err, block){
				if(!err){
					library.bus.message('verifyBlock', block);
				}
			});
		}
		// lets download transactions
		// carefully since order is important to validate block
		else if(transactions.length == 0){
			var transactionIds = block.transactionIds;

			modules.transactions.getMissingTransactions(transactionIds, function(err, missingTransactionIds, transactions){
				if(err){
					return setImmediate(cb, "Cannot process block.", err);
				}
				if(missingTransactionIds.length==0){
					// Great everything is here lets go
					block.transactions=transactions;
					library.bus.message('verifyBlock', block);
				}
				// lets download the missing ones
				else{
					modules.transport.getFromPeer(peer, {
						 method: 'GET',
						api: '/transactionsFromIds?blockid=' + block.id + "&ids="+missingTransactionIds.join(",")
					}, function (err, missingTransactions) {
						 if (err || res.body.error || !res.body.success) {
							 library.logger.debug('Cannot transactions', block.id);
							 return setImmediate(cb, err || error);
						 }
						 library.logger.debug("calling "+peer.ip+":"+peer.port+"/peer/transactionsFromIds");
						 library.logger.debug("received transactions",res.body.transactions);

						 for(var i=0;i<transactionIds.length;i++){
							 var id=transactionIds[i]
							 var tx=transactions.find(function(tx){return tx.id==id});
							 if(tx){
								 transactionIds[i]=tx;
							 }
							 else{
								 tx=missingTransactions.find(function(tx){return tx.id==id});
								 if(tx){
									 transactionIds[i]=tx;
								 }
								 else{
									 //Fucked
									 return setImmediate(cb, "Cannot find all transactions to complete the block.");
								 }
							 }
						 }

						 block.transactions = transactionIds;

						 if(block.transactions.length==block.numberOfTransactions){
							 delete block.transactionIds;
							 self.addToBlockchain(block, function(error, block){
				 				if(!error){
				 					library.bus.message('verifyBlock', block);
				 				}
				 			});
							return setImmediate(cb);
						 }
						 else{
							 return setImmediate(cb, "Block transactions are inconsistant.");
						 }
					 }
				 );
				}
			});
		}
		else{ //block complete
			library.bus.message('verifyBlock', block);
		}
  }
};

NodeManager.prototype.onBlockForged = function(block) {
  block.verified = true;
	block.forged = true;
  block.processed = false;
  self.addToBlockchain(block, function(err, block){
    if(err){
      library.logger.error(err, block);
    }
    else{
      library.logger.info("Forged block added to blockchain", block.id);
      library.bus.message('processBlock', block);
      library.bus.message('broadcastBlock', block);
    }
  });
}

NodeManager.prototype.onBlockVerified = function(block, cb) {
  block.verified = true;
  block.processed = false;
  self.updateBlock(block, function(error, block){
    if(error){
			cb && setImmediate(cb, error, block);
		}
		else{
      library.bus.message('processBlock', block, cb);
      if(block.broadcast){
        library.bus.message('broadcastBlock', block, cb);
      }
    }
  });
}

NodeManager.prototype.onBlockProcessed = function(block, cb) {
  block.processed = true;
  self.updateBlock(block, function(error, block){
    if(error){
			//very bad!
    }
		else{
			__private.timestampState(new Date());

			//Maybe we already got the next block
			// var nextblock = __private.blockchain[""+(block.height+1)];
			// if(nextblock && !nextblock.verified && !nextblock.processed){
			// 	library.bus.message('verifyBlock', nextblock);
			// }
		}
		cb && setImmediate(cb, error, block);
  });
}

NodeManager.prototype.onFork = function (block, cause) {
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
	library.logger.debug('Forked block',block);
};


NodeManager.prototype.onNewTransactions = function(transactions, broadcast) {

};


// manage the internal state logic
__private.timestampState = function (lastReceipt) {
	if(lastReceipt){
		__private.lastReceipt = lastReceipt;
	}
	if (!__private.lastReceipt) {
		__private.lastReceipt = new Date();
		__private.lastReceipt.stale = true;
		__private.lastReceipt.rebuild = false;
		__private.lastReceipt.secondsAgo = 100000;
	}
	else {
		var timeNow = new Date().getTime();
		__private.lastReceipt.secondsAgo = Math.floor((timeNow -  __private.lastReceipt.getTime()) / 1000);
		if(modules.delegates.isActiveDelegate()){
			__private.lastReceipt.stale = __private.lastReceipt.secondsAgo > 8;
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
	}
	return __private.lastReceipt;
};

module.exports = NodeManager;
