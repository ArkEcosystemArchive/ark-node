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
		// TODO: to decrease when bloom filters are implemented
		__private.maxhop = 4;
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

	// Mount the network API
	library.logger.info("# Mounting Network API");
	library.bus.message('attachNetworkApi');

	// If configured, mount the public API (not recommanded for forging node on long term).
	// Ideally we should only mount it when node is synced with network
	if(library.config.api.mount){
		library.logger.info("# Mounting Public API");
		library.bus.message('attachPublicApi');
	}
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

NodeManager.prototype.onBlocksReceived = function(blocks, peer, cb) {
	library.managementSequence.add(function (mSequence) {

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
			return library.bus.message('verifyBlock', block, eachSeriesCb);

		}, function(err){
			if(err){
				library.logger.error(err, currentBlock);
			}
			//console.log(currentBlock.height);
			// we don't deal with download management, just return to say "blocks processed, go ahead"
			return mSequence && setImmediate(mSequence, err, currentBlock);

			// if(!blocks || blocks.length === 0){
			// 	return cb();
			// }
			// else{
			// 	return cb();
			// 	return library.bus.message("downloadBlocks", cb);
			// }

		});

	}, cb);
}

NodeManager.prototype.onRebuildBlockchain = function(blocksToRemove, state, cb) {
	library.managementSequence.add(function (mSequence) {
		modules.loader.getNetwork(true, function(err, network){
			var lastBlock = modules.blockchain.getLastBlock();
			if(!network || !network.height){
				return mSequence && mSequence("Can't find peers to sync with...");
			}
			else if(network.height > lastBlock.height){
				library.logger.info("Observed network height is higher", {network: network.height, node:lastBlock.height});
				library.logger.info("Rebuilding from network");
				return modules.blocks.removeSomeBlocks(blocksToRemove, mSequence);
			}
			else{
				var bestBlock = modules.loader.getNetworkSmallestBlock();
				//network.height is some kind of "conservative" estimation, so some peers can have bigger height
				if(bestBlock && bestBlock.height > lastBlock.height){
					library.logger.info("Observed network is on same height, but some peers with bigger height", {network: {id: bestBlock.id, height:bestBlock.height}, node:{id: lastBlock.id, height:lastBlock.height}});
					library.logger.info("Rebuilding from network");
					return modules.blocks.removeSomeBlocks(blocksToRemove, mSequence);
				}
				else if(bestBlock && bestBlock.height == lastBlock.height && bestBlock.id < lastBlock.id){
					library.logger.info("Observed network is on same height, but found a smaller block id", {network: {id: bestBlock.id, height:bestBlock.height}, node:{id: lastBlock.id, height:lastBlock.height}});
					library.logger.info("Rebuilding from network");
					return modules.blocks.removeSomeBlocks(blocksToRemove, mSequence);
				}
				else{
					library.logger.info("Observed network is on same height, and same smallest block id", {network: network.height, node:lastBlock.height});
					return mSequence && mSequence();
				}
			}
		});
	}, cb);
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
				return cb && cb(err, block);
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
						 var id=transactionIds[i];
						 // assume the list may contains null element
						 var tx=receivedTransactions.find(function(tx){return tx?tx.id==id:false});
						 if(tx){
							 transactionIds[i]=tx;
						 }
						 else{
							 tx=foundTransactions.find(function(tx){return tx.id==id});
							 if(!tx.incomplete){
								 transactionIds[i]=tx;
							 }
							 else{
								 // Fucked! we ignore the block waiting for another one to have it complete.
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
			__private.prepareBlock(block, peer, seriesCb);
		},
		function(data, seriesCb){
			return modules.blocks.removeLastBlock(seriesCb);
		},
		function(data, seriesCb){
			delete block.orphaned;
			block.verified = false;
			block.processed = false;
			block.broadcast = true;
			modules.blockchain.addBlock(block);
			library.bus.message("verifyBlock", block, seriesCb);
		}
	], function(err){
		if(err){
			modules.blockchain.removeBlock(block);
		}
		return cb && cb(err, block);
	});
};

NodeManager.prototype.onBlockReceived = function(block, peer, cb) {
	library.managementSequence.add(function (mSequence) {
		if(!block.ready){
			if(block.orphaned){
				// this lastBlock is "likely" not processed, but the swap anyway will occur in a block sequence.
				var lastBlock = modules.blockchain.getBlockAtHeight(block.height);
				// all right we are at the beginning of a fork, let's swap asap if needed
				if(lastBlock && block.timestamp < lastBlock.timestamp){
					// lowest timestamp win: likely more spread
					library.logger.info("Orphaned block has a smaller timestamp, swaping with lastBlock", {id: block.id, height:block.height});
					return self.swapLastBlockWith(block, peer, mSequence);
				}
				else if(lastBlock && block.timestamp == lastBlock.timestamp && block.id < lastBlock.id){
					// same timestamp, lowest id win: double forgery
					library.logger.info("Orphaned block has same timestamp but smaller id, swaping with lastBlock", {id: block.id, height:block.height});
					return self.swapLastBlockWith(block, peer, mSequence);
				}
				else {
					// no swap
					library.logger.info("Orphaned block has a bigger timestamp or bigger id, block disregarded", {id: block.id, height:block.height});
					return mSequence && mSequence(null, block);
				}
			}
			else {
				library.logger.debug("Block disregarded", {id: block.id, height:block.height});
				return mSequence && mSequence(null, block);
			}
		}
		else {
			library.logger.info("New block received", {id: block.id, height:block.height, transactions: block.numberOfTransactions, peer:peer.string});
			block.verified = false;
			block.processed = false;
			block.broadcast = true;
			__private.prepareBlock(block, peer, function(err, block){
				if(err){
					modules.blockchain.removeBlock(block);
					return mSequence && mSequence(err, block);
				}
				library.logger.debug("processing block with "+block.transactions.length+" transactions", block.height);
				modules.blockchain.addBlock(block);
				return library.bus.message('verifyBlock', block, mSequence);
			});
		}
	}, cb);
};

NodeManager.prototype.onBlockForged = function(block, cb) {
	library.managementSequence.add(function (mSequence) {
		if(!block.ready){
			library.logger.debug("Skip processing block", {id: block.id, height:block.height});
			return mSequence && mSequence(null, block);
		}
		block.verified = true;
		block.forged = true;
	  block.processed = false;
		block.broadcast = true;

		library.logger.info("Processing forged block", block.id);
		library.bus.message('processBlock', block, mSequence);
	}, cb);
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
	library.managementSequence.add(function(mSequence){
		if(!source || typeof source !== "string"){
			mSequence && setImmediate(mSequence, "Rejecting not sourced transactions", transactions);
		}
		// node created the transaction so it is safe include it (data integrity and fee is assumed to be correct)
		if(source.toLowerCase() == "api"){
			transactions.forEach(function(tx){
				tx.id = library.logic.transaction.getId(tx);
				tx.broadcast = true;
				tx.hop = 0;
			});
			//console.log(transactions);
			library.bus.message("addTransactionsToPool", transactions, mSequence);
		}

		// we need sanity check of the transaction list
		else if(source.toLowerCase() == "network"){

			var report = library.schema.validate(transactions, schema.transactions);

			if (!report) {
				return mSequence && setImmediate(mSequence, "Transactions list is not conform", transactions);
			}

			var skimmedtransactions = [];
			async.eachSeries(transactions, function (transaction, cb) {
				try {
					transaction = library.logic.transaction.objectNormalize(transaction);
					transaction.id = library.logic.transaction.getId(transaction);
				} catch (e) {
					return cb(e);
				}

				if(!library.logic.transaction.verifyFee(transaction)){
					return cb("Transaction fee is too low");
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
					return cb();
				});
			}, function (err) {
				if(err){
					return mSequence && mSequence(err);
				}
				if(skimmedtransactions.length>0){
					library.bus.message("addTransactionsToPool", skimmedtransactions, mSequence);
				}
				else{
					return mSequence && mSequence();
				}
			});

		}
		else {
			library.logger.error("Unknown sourced transactions", source);
			mSequence && mSequence("Rejecting unknown sourced transactions", transactions);
		}
	}, cb);
};

module.exports = NodeManager;
