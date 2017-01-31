'use strict';

var async = require('async');
var schema = require('../schema/nodeManager.js');
var sql = require('../sql/nodeManager.js');


var self, library, modules;

var __private = {};

// indexed by height
__private.blockchain = {};

// indexed by id all blocks considered as orphaned
__private.orphanedBlocks = {};


// Constructor
function NodeManager (cb, scope) {
	library = scope;
	self = this;
	if(library.config.maxhop){
		__private.maxhop = library.config.maxhop;
	}
	else{
		__private.maxhop = 10;
	}
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

NodeManager.prototype.upsertBlock = function(block, cb){
  var error = null;
  if(!__private.blockchain[block.height]){
    __private.blockchain[block.height]=block;
  } else if(__private.blockchain[block.height].id!=block.id){
    error = "upsertBlock - Block has been replaced in the blockchain";
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

// return the previousBlock even if orphaned.
// return null if no previous Block found. Likely a fork.
NodeManager.prototype.getPreviousBlock = function(block){
	var previousBlock = __private.blockchain[""+(block.height - 1)];
	//console.log(block.height);
	//console.log(__private.blockchain);
	if(!previousBlock || previousBlock.id !== block.previousBlock){
		previousBlock = __private.orphanedBlocks[block.previousBlock];
	}
	return previousBlock;
}

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
  }
  else{
    library.logger.info("# Started as a relay node");
  }

	library.logger.info("# Mounting Network API");
	library.bus.message('attachNetworkApi');
	if(library.config.api.mount){
		library.logger.info("# Mounting Public API");
		library.bus.message('attachPublicApi');
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
		//if(block.height%1000 == 0){
			library.logger.info("Processsing block height", block.height);
		//}
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

NodeManager.prototype.onBlockReceived = function(block, peer, cb) {
	var lastBlock = self.getLastBlock();
	//console.log(block);
	var previousBlock = self.getPreviousBlock(block);
	//console.log(previousBlock);
  if(!previousBlock){
    library.logger.info("Blockchain is not complete", block);
		// to prevent from spam we accept only blocks close to top of blockchain
		if((lastBlock.height < block.height) && (block.height-lastBlock.height < 5)){
	    block.verified=false;
	    block.processed=false;
	    block.broadcast=true;
	    //self.addToBlockchain(block);
		}
		return cb && setImmediate(cb, null, block);
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
			cb && setImmediate(cb, null, block)
		}

  } else if(previousBlock && block.previousBlock == previousBlock.id){ //all clear
    block.verified=false;
    block.processed=false;
    block.broadcast=true;

		//RECEIVED empty block?
		if(block.numberOfTransactions==0){
			library.logger.debug("processing empty block", block.id);
	    self.addToBlockchain(block, function(err, block){
				if(!err){
					library.bus.message('verifyBlock', block, cb);
				}
			});
		}
		// lets download transactions
		// carefully since order is important to validate block
		else if(block.transactions.length == 0){

			var transactionIds = block.transactionIds;

			modules.transactionPool.getMissingTransactions(transactionIds, function(err, missingTransactionIds, foundTransactions){
				if(err){
					return cb && setImmediate(cb, "Cannot process block.", err);
				}
				if(missingTransactionIds.length==0){
					//console.log(foundTransactions);
					//console.log(block.transactionIds);
					// Great everything is here lets go
					block.transactions=foundTransactions;
					self.addToBlockchain(block, function(err, block){
						if(!err){
							library.bus.message('verifyBlock', block, cb);
						}
					});
				}
				// lets download the missing ones
				else{
					modules.transport.getFromPeer(peer, {
						 method: 'GET',
						api: '/transactionsFromIds?blockid=' + block.id + "&ids='"+missingTransactionIds.join(",")+"'"
					}, function (err, res) {
						library.logger.debug("called "+res.peer.ip+":"+res.peer.port+"/peer/transactionsFromIds");
						 if (err) {
							 library.logger.debug('Cannot get transactions for block', block.id);
							 return setImmediate(cb, err);
						 }

						 var receivedTransactions = res.body.transactions;

						 library.logger.debug("received transactions",receivedTransactions);
						 for(var i=0;i<transactionIds.length;i++){
							 var id=transactionIds[i]
							 var tx=receivedTransactions.find(function(tx){return tx.id==id});
							 if(tx){
								 transactionIds[i]=tx;
							 }
							 else{
								 tx=foundTransactions.find(function(tx){return tx.id==id});
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
				 					library.bus.message('verifyBlock', block, cb);
				 				}
				 			});
							return cb && setImmediate(cb);
						 }
						 else{
							 return cb && setImmediate(cb, "Block transactions are inconsistant.");
						 }
					 }
				 );
				}
			});
		}
		else{ //block complete
			self.addToBlockchain(block, function(err, block){
				if(!err){
					library.bus.message('verifyBlock', block, cb);
				}
			});
		}
  }
};

NodeManager.prototype.onBlockForged = function(block) {
  block.verified = true;
	block.forged = true;
  block.processed = false;
	block.broadcast = true;
  self.addToBlockchain(block, function(err, block){
    if(err){
      library.logger.error(err, block);
    }
    else{
      library.logger.info("Forged block added to blockchain", block.id);
      library.bus.message('processBlock', block);
    }
  });
}

NodeManager.prototype.onBlockVerified = function(block, cb) {
  block.verified = true;
  block.processed = false;
  self.upsertBlock(block, function(error, block){
    if(error){
			cb && setImmediate(cb, error, block);
		}
		else{
      library.bus.message('processBlock', block, cb);
    }
  });
}

NodeManager.prototype.onBlockProcessed = function(block, cb) {
	block.processed = true;
	if(block.broadcast){
		block.broadcast = false;
		library.bus.message('broadcastBlock', block, cb);
	}
	self.upsertBlock(block, function(error, block){
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


NodeManager.prototype.onTransactionsReceived = function(transactions, source, cb) {
	if(!source || typeof source !== "string"){
		cb && setImmediate(cb, "Rejecting not sourced transactions", transactions);
	}
	// node created the transaction so it is safe include it (data integrity and fee is assumed to be correct)
	if(source.toLowerCase() == "api"){
		transactions.forEach(function(tx){
			tx.id = library.logic.transaction.getId(tx);
			tx.broadcast = true;
			tx.hop = 0;
		});
		//console.log(transactions);
		library.bus.message("addTransactionsToPool", transactions, cb);
	}
	// we need sanity check of the transaction list
	else if(source.toLowerCase() == "network"){

		var report = library.schema.validate(transactions, schema.transactions);

		if (!report) {
			return setImmediate(cb, "Transactions list is not conform", transactions);
		}
		var skimmedtransactions = [];

		async.eachSeries(transactions, function (transaction, cb) {
			try {
				transaction = library.logic.transaction.objectNormalize(transaction);
				transaction.id = library.logic.transaction.getId(transaction);
			} catch (e) {
				return setImmediate(cb, e);
			}


			if(!library.logic.transaction.verifyFee(transaction)){
				return setImmediate(cb, "Transaction fee is too low");
			}

			library.db.query(sql.getTransactionId, { id: transaction.id }).then(function (rows) {
				if (rows.length > 0) {
					library.logger.debug('Transaction ID is already in blockchain', transaction.id);
				}
				else{ // we only broadcast tx with known hop.
					transaction.broadcast = false;
					if(transaction.hop){
						transaction.hop = parseInt(transaction.hop);
						if(transaction.hop > -1 && transaction.hop < __private.maxhop){
							transaction.hop++;
							transaction.broadcast = true;
						}
					}
					else { // TODO: backward compatibility, to deprecate
						transaction.hop = 1;
						transaction.broadcast = true;
					}
					skimmedtransactions.push(transaction);
				}
				return setImmediate(cb);
			});
		}, function (err) {
			if(err){
				return setImmediate(cb, err);
			}
			if(skimmedtransactions.length>0){
				library.bus.message("addTransactionsToPool", skimmedtransactions, cb);
			}
			else{
				return setImmediate(cb);
			}
		});
	}
	else {
		library.logger.error("Unknown sourced transactions", source);
		setImmediate(cb, "Rejecting unknown sourced transactions", transactions);
	}

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
