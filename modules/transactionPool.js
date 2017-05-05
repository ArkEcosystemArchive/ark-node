'use strict';

var async = require('async');
var constants = require('../helpers/constants.js');
var transactionTypes = require('../helpers/transactionTypes.js');
var slots = require('../helpers/slots.js');

// Private fields
var modules, library, self, __private = {};

// Constructor
function TransactionPool (cb, scope) {
	library = scope;
	self = this;

	__private.active=false;

	self.unconfirmed = { };
	self.queued = { };
	self.multisignature = { };

	// TODO: to remove
	self.expiryInterval = 30000;

	// mem pool for efficiency keeping tx for 72 hours
	__private.mempool = null;

	__private.mempoolConfig = library.config.mempool;
	if(!__private.mempoolConfig){
		__private.mempoolConfig = {
			intervalInSeconds: 3600*1000, // every hours
			maximumAgeInMinutes: 72*3600  // 72 hours
		}
	}
	else{
		if(!__private.mempoolConfig.intervalInSeconds){
			__private.mempoolConfig.intervalInSeconds=intervalInSeconds=3600*1000;
		}
		if(!__private.mempoolConfig.maximumAgeInMinutes){
			__private.mempoolConfig.maximumAgeInMinutes=72*3600;
		}
	}

	cb(null, self);
}

// Public methods
//
//__EVENT__ `onBind`

//
TransactionPool.prototype.onBind = function (scope) {
	modules = scope;
};

//
//__EVENT__ `onStartTransactionPool`

//
TransactionPool.prototype.onStartTransactionPool = function () {
	if(__private.active){
		return;
	}
	__private.mempool = {};
	__private.active = true;

	// setImmediate(function fillPool () {
	// 	async.series([
	// 		self.fillPool
	// 	], function (err) {
	// 		if (err) {
	// 			library.logger.log('fillPool transaction timer', err);
	// 		}
	// 		if(__private.active){
	// 			return setTimeout(fillPool, 1000);
	// 		}
	// 	});
	// });

	// Transaction expiry timer
	// TODO: to remove
	setImmediate(function nextExpiry () {
		async.series([
			self.expireTransactions
		], function (err) {
			if (err) {
				library.logger.log('Transaction expiry timer', err);
			}

			if(__private.active){
				return setTimeout(nextExpiry, self.expiryInterval);
			}
		});
	});

	// Mempool management to remove tx older than __private.mempoolConfig.maximumAgeInMinutes
	// launched every __private.mempoolConfig.intervalInSeconds
	setImmediate(function cleanMempool() {
		var expirationdate=slots.getTime()-__private.mempoolConfig.maximumAgeInMinutes*60;
		var removed = 0;
		var kept = 0;
		for(var txid in __private.mempool){
			if(__private.mempool[txid].timestamp < expirationdate){
				removed++;
				delete __private.mempool[txid];
				self.removeUnconfirmedTransaction(txid);
			}
			else {
				kept++;
			}
		}
		library.logger.info("Mempool cleaned: "+removed+" transaction(s) removed, "+kept+" transaction(s) kept");

		if(__private.active){
			return setTimeout(cleanMempool, __private.mempoolConfig.intervalInSeconds);
		}
	});

	library.logger.info('Transaction pool started');
};

//
//__EVENT__ `onStopTransactionPool`

//
TransactionPool.prototype.onStopTransactionPool = function () {
	__private.active = false;
	// flush mempool
	__private.mempool = null;
	library.logger.info('# Transaction pool stopped');
};

//
//__EVENT__ `onAddTransactionsToPool`

//
TransactionPool.prototype.onAddTransactionsToPool = function (transactions, cb) {
	self.receiveTransactions(transactions, cb);
};

//
//__API__ `transactionInPool`

//
TransactionPool.prototype.transactionInPool = function (id) {
	return [
		self.unconfirmed[id],
		self.queued[id],
		self.multisignature[id]
	].filter(Boolean).length > 0;
};

//
//__API__ `getTransactionFromMempool`

//
TransactionPool.prototype.getTransactionFromMempool = function (id) {
	return __private.mempool[id];
};

//
//__API__ `getUnconfirmedTransaction`

//
TransactionPool.prototype.getUnconfirmedTransaction = function (id) {
	return self.unconfirmed[id];
};

//
//__API__ `getQueuedTransaction`

//
TransactionPool.prototype.getQueuedTransaction = function (id) {
	return self.queued[id];
};

//
//__API__ `getMultisignatureTransaction`

//
TransactionPool.prototype.getMultisignatureTransaction = function (id) {
	return self.multisignature[id];
};

//
//__API__ `getMissingTransactions`

//
TransactionPool.prototype.getMissingTransactions = function (ids, cb) {
	return __private.getMissingTransactions(ids, cb);
};

//
//__API__ `getUnconfirmedTransactionList`

//
TransactionPool.prototype.getUnconfirmedTransactionList = function (reverse, limit) {
	return __private.getTransactionList(self.unconfirmed, reverse, limit);
};


//
//__API__ `getQueuedTransactionList `

//
TransactionPool.prototype.getQueuedTransactionList  = function (reverse, limit) {
	return __private.getTransactionList(self.queued, reverse, limit);
};

//
//__API__ `getMultisignatureTransactionList`

//
TransactionPool.prototype.getMultisignatureTransactionList = function (reverse, ready, limit) {
	if (ready) {
		return __private.getTransactionList(self.multisignature, reverse).filter(function (transaction) {
			return transaction.ready;
		});
	} else {
		return __private.getTransactionList(self.multisignature, reverse, limit);
	}
};

//
//__API__ `getMergedTransactionList`

//
TransactionPool.prototype.getMergedTransactionList = function (reverse, limit) {
	var minLimit = (constants.maxTxsPerBlock + 2);

	if (limit <= minLimit || limit > constants.maxSharedTxs) {
		limit = minLimit;
	}

	var unconfirmed = modules.transactionPool.getUnconfirmedTransactionList(false, constants.maxTxsPerBlock);
	limit -= unconfirmed.length;

	var multisignatures = modules.transactionPool.getMultisignatureTransactionList(false, false, constants.maxTxsPerBlock);
	limit -= multisignatures.length;

	var queued = modules.transactionPool.getQueuedTransactionList(false, limit);
	limit -= queued.length;

	return unconfirmed.concat(multisignatures).concat(queued);
};

//
//__API__ `addUnconfirmedTransaction`

//
TransactionPool.prototype.addUnconfirmedTransaction = function (transaction) {
	if (transaction.type === transactionTypes.MULTI || Array.isArray(transaction.signatures)) {
		self.removeMultisignatureTransaction(transaction.id);
	} else {
		self.removeQueuedTransaction(transaction.id);
	}
	if (!self.unconfirmed[transaction.id]) {
		if (!transaction.receivedAt) {
			transaction.receivedAt = new Date();
		}
		self.unconfirmed[transaction.id] = transaction;
	}
};

//
//__API__ `removeUnconfirmedTransaction`

//
TransactionPool.prototype.removeUnconfirmedTransaction = function (id) {
	delete self.unconfirmed[id];

	self.removeQueuedTransaction(id);
	self.removeMultisignatureTransaction(id);
};

//
//__API__ `countUnconfirmed`

//
TransactionPool.prototype.countUnconfirmed = function () {
	return Object.keys(self.unconfirmed).length;
};


//
//__API__ `removeQueuedTransaction`

//
TransactionPool.prototype.removeQueuedTransaction = function (id) {
	delete self.queued[id];
};

//
//__API__ `countQueued`

//
TransactionPool.prototype.countQueued = function () {
	return Object.keys(self.queued).length;
};



//
//__API__ `removeMultisignatureTransaction`

//
TransactionPool.prototype.removeMultisignatureTransaction = function (id) {
	delete self.multisignature[id];
};

//
//__API__ `countMultisignature`

//
TransactionPool.prototype.countMultisignature = function () {
	return Object.keys(self.multisignature).length;
};

//
//__API__ `addToMempool`

//
TransactionPool.prototype.addToMempool = function(transaction){
	__private.mempool[transaction.id]=transaction;
};


//
//__API__ `getMempoolSize`

//
TransactionPool.prototype.getMempoolSize = function(){
	return Object.keys(__private.mempool).length;
};

//
//__API__ `receiveTransactions`

//
TransactionPool.prototype.receiveTransactions = function (transactions, cb) {

	var expirationdate=slots.getTime()-__private.mempoolConfig.maximumAgeInMinutes*60;
	async.eachSeries(transactions, function (transaction, eachSeriesCb) {
		var memtx=__private.mempool[transaction.id];
		if(memtx){
			if(memtx.error){ // sounds like already rejected.
				cb(memtx.error);
			}
			else{ // already verified
				return eachSeriesCb();
			}
		}
		else if(transaction.timestamp < expirationdate){ // too old, ignore
			// ignore
			return eachSeriesCb();
		}
		else {
			// we add transaction in mempool but still can be a spam.
			// be sure to remove if there is an error in processing
			__private.mempool[transaction.id]=transaction;
			__private.processVerifyTransaction(transaction, function (err) {
				if (!err) {
					return self.queueTransaction(transaction, eachSeriesCb);
				} else {
					// TODO: do we want to remove from mempool if somebody is spamming?
					// we delete the tx in 1 min, so max 1 verification per spammy tx
					// we keep the error in memory.
					transaction.error=err;
					setTimeout(function(){
						delete __private.mempool[transaction.id];
					}, 60000);
					return eachSeriesCb(err, transaction);
				}
			});
		}

	}, function (err) {
		return cb(err, transactions);
	});
};



//
//__API__ `queueTransaction`

//
TransactionPool.prototype.queueTransaction = function (transaction, cb) {
	delete transaction.receivedAt;



  if (transaction.type === transactionTypes.MULTI || Array.isArray(transaction.signatures)) {
		if (self.countMultisignature() >= constants.maxTxsPerQueue) {
			return cb('Multisignature Transaction pool is full');
		} else if (!self.multisignature[transaction.id]) {
			self.multisignature[transaction.id] = transaction;
		}
	} else if (!self.queued[transaction.id]){
		if (self.countQueued() >= constants.maxTxsPerQueue) {
			return cb('Transaction pool is full');
		} else {
			self.queued[transaction.id] = transaction;
		}
	}

	return cb();
};

//
//__API__ `applyUnconfirmedList`

//
TransactionPool.prototype.applyUnconfirmedList = function (cb) {
	return __private.applyUnconfirmedList(self.getUnconfirmedTransactionList(true), cb);
};

//
//__API__ `applyUnconfirmedIds`

//
TransactionPool.prototype.applyUnconfirmedIds = function (ids, cb) {
	return __private.applyUnconfirmedList(ids, cb);
};

//
//__API__ `undoUnconfirmedList`

//
TransactionPool.prototype.undoUnconfirmedList = function (keepUnconfirmedTransactions, cb) {
	var removedIds = [], keptIds = [];
	var keepIds = keepUnconfirmedTransactions.map(function(tx){return tx.id});

	async.eachSeries(self.getUnconfirmedTransactionList(false), function (transaction, eachSeriesCb) {

		if (transaction && (keepIds.indexOf(transaction.id) == -1)) {
			removedIds.push(transaction.id);
			modules.transactions.undoUnconfirmed(transaction, function (err) {
				if (err) {
					library.logger.error('Failed to undo unconfirmed transaction: ' + transaction.id, err);
				}
				self.removeUnconfirmedTransaction(transaction.id);
				return eachSeriesCb(err);
			});
		} else {
			keptIds.push(transaction.id);
			return eachSeriesCb();
		}
	}, function (err) {
		return cb(err, removedIds, keptIds);
	});
};

// TODO: to remove
//
//__API__ `expireTransactions`

//
TransactionPool.prototype.expireTransactions = function (cb) {
	var ids = [];

	async.waterfall([
		function (seriesCb) {
			__private.expireTransactions(self.getUnconfirmedTransactionList(true), ids, seriesCb);
		},
		function (res, seriesCb) {
			__private.expireTransactions(self.getQueuedTransactionList(true), ids, seriesCb);
		},
		function (res, seriesCb) {
			__private.expireTransactions(self.getMultisignatureTransactionList(true, false), ids, seriesCb);
		}
	], function (err, ids) {
		return cb(err, ids);
	});
};


//
//__API__ `cleanup`

// This is stategic to keep mem_accounts cleaned
TransactionPool.prototype.cleanup = function (cb) {
	self.undoUnconfirmedList([], function(err, removedIds, keptIds){
		if(err){
			library.logger.error('Error cleaning TransactionPool', err);
		}
		else{
			library.logger.info('Cleaned TransactionPool. Unconfirmed transations undone: ' + removedIds.length);
		}
		return cb();
	});
};

//
//__API__ `fillPool`

//
TransactionPool.prototype.fillPool = function (maxtx, cb) {

	var unconfirmedCount = self.countUnconfirmed();

	if (unconfirmedCount >= maxtx) {
		return cb();
	} else {
		var spare = 0, spareMulti;
		var multisignatures;
		var multisignaturesLimit = 5;
		var transactions;



		spare = (constants.maxTxsPerBlock - unconfirmedCount);
		spareMulti = (spare >= multisignaturesLimit) ? multisignaturesLimit : 0;
		multisignatures = self.getMultisignatureTransactionList(true, true, multisignaturesLimit).slice(0, spareMulti);
		spare = Math.abs(spare - multisignatures.length);
		transactions = self.getQueuedTransactionList(true, constants.maxTxsPerBlock).slice(0, spare);
		transactions = multisignatures.concat(transactions);

		transactions.forEach(function (transaction)  {
			self.addUnconfirmedTransaction(transaction);
		});

		if(transactions.length>0){
			library.logger.debug('Transaction pool size: ' + self.countUnconfirmed());
		}

		return __private.applyUnconfirmedList(transactions, cb);
	}
};

// Private
__private.getTransactionList = function (transactions, reverse, limit) {
	var a = [];

	for (var i in transactions) {
		var transaction = transactions[i];

		if (transaction)	{
			a.push(transaction);
		}
	}

	a = reverse ? a.reverse() : a;

	if (limit) {
		a.splice(limit);
	}

	return a;
};

__private.getMissingTransactions = function(ids, cb){
	var missingtransactionsids=[];
	// copy of ids
	var transactions = JSON.parse(JSON.stringify(ids));
	for(var i in ids){
		var tx=__private.mempool[ids[i]];
		if(tx){
			if(tx.type == 4 || tx.signatures){ // dirty dirty, but multi is broken: we need to fetch fresh version of tx from remote.
				transactions[i]={id:ids[i]};
				missingtransactionsids.push(ids[i]);
			}
			else{
				transactions[i]=tx;
			}
		}
		else{
			// beware we send an incomplete transaction, to be taken care of
			transactions[i] = {
				id:ids[i],
				incomplete:true
			};
			missingtransactionsids.push(ids[i]);
		}
	}
	cb(null, missingtransactionsids, transactions);
}

__private.processVerifyTransaction = function (transaction, cb) {
	async.waterfall([
		function setAccountAndGet (waterCb) {
			modules.accounts.setAccountAndGet({publicKey: transaction.senderPublicKey}, waterCb);
		},
		function verifyTransaction (sender, waterCb) {
			library.logic.transaction.verify(transaction, sender, function (err) {
				if (err) {
					return waterCb(err);
				} else {
					return waterCb(null, sender);
				}
			});
		},
		function getRequester (sender, waterCb) {
			var multisignatures = Array.isArray(sender.multisignatures) && sender.multisignatures.length;

			if (multisignatures) {
				transaction.signatures = transaction.signatures || [];
			}

			if (sender && transaction.requesterPublicKey && multisignatures) {
				modules.accounts.getAccount({publicKey: transaction.requesterPublicKey}, function (err, requester) {
					if (!requester) {
						return waterCb('Requester not found');
					} else {
						return waterCb(null, sender, requester);
					}
				});
			} else {
				return waterCb(null, sender, null);
			}
		},
		function processTransaction (sender, requester, waterCb) {
			library.logic.transaction.process(transaction, sender, requester, function (err) {
				if (err) {
					return waterCb(err);
				} else {
					return waterCb(null, sender);
				}
			});
		}
	], cb);
};

__private.applyUnconfirmedList = function (transactions, cb) {
	async.eachSeries(transactions, function (transaction, eachSeriesCb) {
		if (typeof transaction === 'string') {
			transaction = self.getUnconfirmedTransaction(transaction);
		}
		if (!transaction) {
			return eachSeriesCb();
		}

		__private.processVerifyTransaction(transaction, function (err, sender) {
			if (err) {
				library.logger.debug('Failed to process / verify unconfirmed transaction: ' + transaction.id, err);
				self.removeUnconfirmedTransaction(transaction.id);
				return eachSeriesCb();
			}
			modules.transactions.applyUnconfirmed(transaction, function (err) {
				if (err) {
					library.logger.debug('Failed to apply unconfirmed transaction: ' + transaction.id, err);
					self.removeUnconfirmedTransaction(transaction.id);
				}
				return eachSeriesCb();
			});
		});
	}, cb);
};

// TODO: to remove
__private.transactionTimeOut = function (transaction) {
	if (transaction.type === transactionTypes.MULTI) {
		return (transaction.asset.multisignature.lifetime * 3600);
	} else if (Array.isArray(transaction.signatures)) {
		return (constants.unconfirmedTransactionTimeOut * 8);
	} else {
		return (constants.unconfirmedTransactionTimeOut);
	}
};

// TODO: to remove
__private.expireTransactions = function (transactions, parentIds, cb) {
	var ids = [];

	async.eachSeries(transactions, function (transaction, eachSeriesCb) {
		if (!transaction) {
			return eachSeriesCb();
		}

		var timeNow = new Date();
		var timeOut = __private.transactionTimeOut(transaction);
		var seconds = Math.floor((timeNow.getTime() - new Date(transaction.receivedAt).getTime()) / 1000);

		if (seconds > timeOut) {
			ids.push(transaction.id);
			self.removeUnconfirmedTransaction(transaction.id);
			library.logger.info('Expired transaction: ' + transaction.id + ' received at: ' + transaction.receivedAt.toUTCString());
			return eachSeriesCb();
		} else {
			return eachSeriesCb();
		}
	}, function (err) {
		return cb(err, ids.concat(parentIds));
	});
};

// Export
module.exports = TransactionPool;
