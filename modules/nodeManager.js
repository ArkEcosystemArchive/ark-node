'use strict';

var async = require('async');
var schema = require('../schema/nodeManager.js');
var sql = require('../sql/nodeManager.js');


var self, library, modules;

var __private = {};

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


NodeManager.prototype.onDatabaseLoaded = function(lastBlock) {
  library.bus.message('loadDelegates');
	library.bus.message('startTransactionPool');
	library.bus.message('startBlockchain');
};

NodeManager.prototype.onDelegatesLoaded = function(keypairs) {
  var numberOfDelegates=Object.keys(keypairs).length;

	// If there are some delegates configured, start forging, else just relay tx and blocks
  if(numberOfDelegates>0){
    __private.keypairs=keypairs;
    library.logger.info("# Loaded "+numberOfDelegates+" delegate(s). Started as a forging node");
    library.bus.message('startForging');
  }
  else{
    library.logger.info("# Started as a relay node");
  }

	// Mount the network API
	library.logger.info("# Mounting Network API");
	library.bus.message('attachNetworkApi');

	// If configured, mount the public API (not recommanded for forging node on long term).
	if(library.config.api.mount){
		library.logger.info("# Mounting Public API");
		library.bus.message('attachPublicApi');
	}
};

NodeManager.prototype.onNetworkApiAttached = function(){
  library.bus.message('updatePeers');
}

NodeManager.prototype.onPeersUpdated = function() {
	library.bus.message('observeNetwork');
};

NodeManager.prototype.onNetworkObserved = function(network){
	if(!__private.lastBlock || network.height > __private.lastBlock.height){
		library.bus.message('downloadBlocks', function(err,lastBlock){
			//console.log("bla");
		});
	}
}


// deprecated, not used, here for info
// NodeManager.prototype.onReceiveBlock = function (block, peer) {
// 	//we make sure we process one block at a time
// 	library.sequence.add(function (cb) {
// 		var lastBlock = modules.blockchain.getLastBlock();
//
// 		if (block.previousBlock === lastBlock.id && lastBlock.height + 1 === block.height) {
// 			library.logger.info([
// 				'Received new block id:', block.id,
// 				'height:', block.height,
// 				'round:',  modules.rounds.calc(block.height),
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
// 			else {
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

NodeManager.prototype.onBlocksReceived = function(blocks, peer, cb) {
	var currentBlock;
	async.eachSeries(blocks, function (block, eachSeriesCb) {
		block.reward = parseInt(block.reward);
		block.totalAmount = parseInt(block.totalAmount);
		block.totalFee = parseInt(block.totalFee);
		block.verified = false;
	  block.processed = false;

		// rationale: onBlocksReceived received is called within another thread than onBlockReceived
		// so we prevent from processing blocks we asked for and we received in the between via normal broadcast
		if(block.height <= modules.blockchain.getLastIncludedBlock().height){
			return eachSeriesCb(null, block);
		}

		modules.blockchain.addBlock(block);
		currentBlock=block;
		if(block.height%100 == 0){
			library.logger.info("Processing block height", block.height);
		}
		library.bus.message('verifyBlock', block, eachSeriesCb);

	}, function(err){
		if(err){
			library.logger.error(err, currentBlock);
		}
		//console.log(currentBlock.height);
		// we don't deal with download management, just return to say "blocks processed, go ahead"
		return cb(err, currentBlock);

		// if(!blocks || blocks.length === 0){
		// 	return cb();
		// }
		// else{
		// 	return cb();
		// 	return library.bus.message("downloadBlocks", cb);
		// }

	});
}

NodeManager.prototype.onRebuildBlockchain = function(blocksToRemove, state, cb) {
	return modules.loader.getNetwork(true, function(err, network){
		var lastBlock = modules.blockchain.getLastBlock();
		if(!network || !network.height){
			cb("Can't find peers to sync with...");
		}
		if(network.height > lastBlock.height){
			library.logger.info("Observed network height is higher", {network: network.height, node:lastBlock.height});
			library.logger.info("Rebuilding from network");
			modules.blocks.removeSomeBlocks(blocksToRemove, function(error, lastBlock){
				library.bus.message("downloadBlocks", cb);
			});
		}
		else{
			var bestBlock = modules.loader.getNetworkSmallestBlock();
			//network.height is some kind of "conservative" estimation, so some peers can have bigger height
			if(bestBlock && bestBlock.height > lastBlock.height){
				library.logger.info("Observed network is on same height, but some peers with bigger height", {network: {id: bestBlock.id, height:bestBlock.height}, node:{id: lastBlock.id, height:lastBlock.height}});
				library.logger.info("Rebuilding from network");
				modules.blocks.removeSomeBlocks(blocksToRemove, function(error, lastBlock){
					library.bus.message("downloadBlocks", cb);
				});
			}
			else if(bestBlock && bestBlock.height == lastBlock.height && bestBlock.id != lastBlock.id){
				library.logger.info("Observed network is on same height, but found a smaller block id", {network: {id: bestBlock.id, height:bestBlock.height}, node:{id: lastBlock.id, height:lastBlock.height}});
				library.logger.info("Rebuilding from network");
				modules.blocks.removeSomeBlocks(blocksToRemove, function(error, lastBlock){
					library.bus.message("downloadBlocks", cb);
				});
			}
			else{
				library.logger.info("Observed network is on same height, and same smallest block id", {network: network.height, node:lastBlock.height});
				cb();
			}
		}
	});
};


//make sure the block transaction list is complete, otherwise try to find transactions
__private.prepareBlock = function(block, peer, cb){

	//RECEIVED empty block?
	if(block.numberOfTransactions == 0){
		return cb && cb(null, block);
	}
	// lets download transactions
	// carefully since order is important to validate block
	else if(block.transactions.length == 0){
		var transactionIds = block.transactionIds;

		// get transactions by id from mempool
		modules.transactionPool.getMissingTransactions(transactionIds, function(err, missingTransactionIds, foundTransactions){
			if(err){
				return cb && cb("Cannot process block", block);
			}

			// great! All transactions were in mempool lets go!
			if(missingTransactionIds.length==0){
				delete block.transactionIds;
				block.transactions=foundTransactions;
				return cb && cb(null, block);
			}
			// lets download the missing ones from the peer that sent the block.
			else{
				modules.transport.getFromPeer(peer, {
					 method: 'GET',
					api: '/transactionsFromIds?blockid=' + block.id + "&ids='"+missingTransactionIds.join(",")+"'"
				}, function (err, res) {
					library.logger.debug("called "+res.peer.ip+":"+res.peer.port+"/peer/transactionsFromIds");
					 if (err) {
						 library.logger.debug('Cannot get transactions for block', block.id);
						 return cb && cb(null, block);
					 }

					 var receivedTransactions = res.body.transactions;
					 library.logger.debug("received transactions", receivedTransactions.length);

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
								 return cb && cb("Cannot find all transactions to complete the block", block);
							 }
						 }
					 }

					 // transactionsIds now has the transactions in same order as original block
					 block.transactions = transactionIds;

					 // sanity check everything looks ok
					 if(block.transactions.length==block.numberOfTransactions){
						 //removing useless data
						 delete block.transactionIds;
						 return cb && cb(null, block);
					 }

					 // we should never end up here
					 else{
						 return cb && cb("Block transactions are inconsistant. This is likely a bug, please report.", block);
					 }
				 }
			 );
			}
		});
	}
	else { //block received complete
		return cb && cb(null, block);
	}
}

NodeManager.prototype.swapLastBlockWith = function(block, peer, cb){
	async.waterfall([
		function(seriesCb){
			return modules.blocks.removeLastBlock(seriesCb);
		},
		function(data, seriesCb){
			delete block.orphaned;
			block.verified = false;
			block.processed = false;
		  block.broadcast = true;
			__private.prepareBlock(block, peer, seriesCb);
		},
		function(data, seriesCb){
			modules.blockchain.addBlock(block);
			modules.bus.message("verifyBlock", block, seriesCb);
		}
	], cb);
};

NodeManager.prototype.onBlockReceived = function(block, peer, cb) {
	if(!block.ready){
		if(block.orphaned){
			var lastBlock = modules.blockchain.getLastBlock();
			if(lastBlock.height == block.height){
			  //all right we are at the beginning of a fork, let's swap asap if needed
				if(block.id < lastBlock.id){ // lowest id win
					library.logger.info("Orphaned block has a smaller id, swaping with lastBlock", {id: block.id, height:block.height});
					return modules.blocks.swapLastBlockWith(block, peer, cb);
				}
				else {
					library.logger.info("Orphaned block has a bigger id, processing skipped", {id: block.id, height:block.height});
					return cb && cb(null, block);
				}
			}
			else {
				return cb && cb(null, block);
			}
		}
		else {
			library.logger.debug("Skip processing block", {id: block.id, height:block.height});
			return cb && cb(null, block);
		}
	}
	else {
		library.logger.info("New block received", {id: block.id, height:block.height, transactions: block.numberOfTransactions, peer:peer.string});
		block.verified = false;
		block.processed = false;
		block.broadcast = true;
		__private.prepareBlock(block, peer, function(err, block){

			modules.blockchain.addBlock(block);
			library.logger.debug("processing block with "+foundTransactions.length+" transactions", block.height);
			return library.bus.message('verifyBlock', block, cb);
		});
	}
};

NodeManager.prototype.onBlockForged = function(block, cb) {
	if(!block.ready){
		library.logger.debug("Skip processing block", {id: block.id, height:block.height});
		return cb && cb(null, block);
	}
	block.verified = true;
	block.forged = true;
  block.processed = false;
	block.broadcast = true;

	library.logger.info("Processing forged block", block.id);
	library.bus.message('processBlock', block, cb);
}

NodeManager.prototype.onBlockVerified = function(block, cb) {
	//console.log("onBlockVerified - "+block.height);
	library.bus.message('processBlock', block, cb);
}

NodeManager.prototype.onBlockProcessed = function(block, cb) {
	//console.log(block.height);
	//console.log("onBlockProcessed - "+ block.height);
	if(block.broadcast){
		library.bus.message('broadcastBlock', block);
	}
	cb && cb(null, block);
}

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

		//encapsulating in blockSequence so unconfirmed transactions are not applied while processing block
		library.blockSequence.add(function(sequenceCb){

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
					return setImmediate(sequenceCb, err);
				}
				if(skimmedtransactions.length>0){
					library.bus.message("addTransactionsToPool", skimmedtransactions, sequenceCb);
				}
				else{
					return setImmediate(sequenceCb);
				}
			});
		}, cb);


	}
	else {
		library.logger.error("Unknown sourced transactions", source);
		setImmediate(cb, "Rejecting unknown sourced transactions", transactions);
	}

};

module.exports = NodeManager;
