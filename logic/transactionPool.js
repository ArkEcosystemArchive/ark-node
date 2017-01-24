'use strict';

var async = require('async');
var constants = require('../helpers/constants.js');
var transactionTypes = require('../helpers/transactionTypes.js');

// Private fields
var modules, library, self, __private = {};

// Constructor
function TransactionPool (scope) {
	library = scope;
	self = this;

	self.unconfirmed = { };
	self.bundled = { };
	self.queued = { };
	self.multisignature = { };
	self.expiryInterval = 30000;
	self.bundledInterval = 5000;
	self.bundleLimit = 25;
	self.processed = 0;

	// Bundled transaction timer
	setImmediate(function nextBundle () {
		async.series([
			self.processBundled
		], function (err) {
			if (err) {
				library.logger.log('Bundled transaction timer', err);
			}

			return setTimeout(nextBundle, self.bundledInterval);
		});
	});

	// Transaction expiry timer
	setImmediate(function nextExpiry () {
		async.series([
			self.expireTransactions
		], function (err) {
			if (err) {
				library.logger.log('Transaction expiry timer', err);
			}

			return setTimeout(nextExpiry, self.expiryInterval);
		});
	});
}

// Public methods
TransactionPool.prototype.bind = function (scope) {
	modules = scope;
};

TransactionPool.prototype.transactionInPool = function (id) {
	return [
		self.unconfirmed[id],
		self.bundled[id],
		self.queued[id],
		self.multisignature[id]
	].filter(Boolean).length > 0;
};

TransactionPool.prototype.getUnconfirmedTransaction = function (id) {
	return self.unconfirmed[id];
};

TransactionPool.prototype.getBundledTransaction = function (id) {
	return self.bundled[id];
};

TransactionPool.prototype.getQueuedTransaction = function (id) {
	return self.queued[id];
};

TransactionPool.prototype.getMultisignatureTransaction = function (id) {
	return self.multisignature[id];
};

TransactionPool.prototype.getUnconfirmedTransactionList = function (reverse, limit) {
	return __private.getTransactionList(self.unconfirmed, reverse, limit);
};

TransactionPool.prototype.getBundledTransactionList  = function (reverse, limit) {
	return __private.getTransactionList(self.bundled, reverse, limit);
};

TransactionPool.prototype.getQueuedTransactionList  = function (reverse, limit) {
	return __private.getTransactionList(self.queued, reverse, limit);
};

TransactionPool.prototype.getMultisignatureTransactionList = function (reverse, ready, limit) {
	if (ready) {
		return __private.getTransactionList(self.multisignature, reverse).filter(function (transaction) {
			return transaction.ready;
		});
	} else {
		return __private.getTransactionList(self.multisignature, reverse, limit);
	}
};

TransactionPool.prototype.getMergedTransactionList = function (reverse, limit) {
	var minLimit = (constants.maxTxsPerBlock + 2);

	if (limit <= minLimit || limit > constants.maxSharedTxs) {
		limit = minLimit;
	}

	var unconfirmed = modules.transactions.getUnconfirmedTransactionList(false, constants.maxTxsPerBlock);
	limit -= unconfirmed.length;

	var multisignatures = modules.transactions.getMultisignatureTransactionList(false, false, constants.maxTxsPerBlock);
	limit -= multisignatures.length;

	var queued = modules.transactions.getQueuedTransactionList(false, limit);
	limit -= queued.length;

	return unconfirmed.concat(multisignatures).concat(queued);
};

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

TransactionPool.prototype.removeUnconfirmedTransaction = function (id) {
	delete self.unconfirmed[id];


	self.removeBundledTransaction(id);
	self.removeQueuedTransaction(id);
	self.removeMultisignatureTransaction(id);
};

TransactionPool.prototype.countUnconfirmed = function () {
	return Object.keys(self.unconfirmed).length;
};

TransactionPool.prototype.addBundledTransaction = function (transaction) {
	self.bundled[transaction.id] = transaction;
};

TransactionPool.prototype.removeBundledTransaction = function (id) {
  delete self.bundled[id];
};

TransactionPool.prototype.countBundled = function () {
	return Object.keys(self.bundled).length;
};

TransactionPool.prototype.addQueuedTransaction = function (transaction) {
	if (!self.queued[transaction.id]) {
		if (!transaction.receivedAt) {
			transaction.receivedAt = new Date();
		}

		self.queued[transaction.id] = transaction;
	}
};

TransactionPool.prototype.removeQueuedTransaction = function (id) {
	delete self.queued[id];
};

TransactionPool.prototype.countQueued = function () {
	return Object.keys(self.queued).length;
};

TransactionPool.prototype.addMultisignatureTransaction = function (transaction) {

	if (!self.multisignature[transaction.id]) {
		if (!transaction.receivedAt) {
			transaction.receivedAt = new Date();
		}

		self.multisignature[transaction.id] = transaction;
	}
};

TransactionPool.prototype.removeMultisignatureTransaction = function (id) {
	delete self.multisignature[id];
};

TransactionPool.prototype.countMultisignature = function () {
	return Object.keys(self.multisignature).length;
};

TransactionPool.prototype.receiveTransactions = function (transactions, broadcast, cb) {
	async.eachSeries(transactions, function (transaction, cb) {
		self.processUnconfirmedTransaction(transaction, broadcast, cb);
	}, function (err) {
		return setImmediate(cb, err, transactions);
	});
};


TransactionPool.prototype.processBundled = function (cb) {
	var bundled = self.getBundledTransactionList(true, self.bundleLimit);

	async.eachSeries(bundled, function (transaction, eachSeriesCb) {
		if (!transaction) {
			return setImmediate(eachSeriesCb);
		}

		__private.processVerifyTransaction(transaction, true, function (err, sender) {
			if (err) {
				library.logger.debug('Failed to process / verify bundled transaction: ' + transaction.id, err);
				self.removeUnconfirmedTransaction(transaction);
				return setImmediate(eachSeriesCb);
			} else {
				self.queueTransaction(transaction, function (err) {
					if (err) {
						library.logger.debug('Failed to queue bundled transaction: ' + transaction.id, err);
					}
					return setImmediate(eachSeriesCb);
				});
			}
		});
	}, function (err) {
		return setImmediate(cb, err);
	});
};

TransactionPool.prototype.processUnconfirmedTransaction = function (transaction, broadcast, cb) {
	if (self.transactionInPool(transaction.id)) {
		return setImmediate(cb, 'Transaction is already processed: ' + transaction.id);
	}

	if (transaction.bundled) {
		return self.queueTransaction(transaction, cb);
	}

	__private.processVerifyTransaction(transaction, broadcast, function (err) {
		if (!err) {
			return self.queueTransaction(transaction, cb);
		} else {
			return setImmediate(cb, err);
		}
	});
};

TransactionPool.prototype.queueTransaction = function (transaction, cb) {
	delete transaction.receivedAt;

	if (transaction.bundled) {
		if (self.countBundled() >= constants.maxTxsPerQueue) {
			return setImmediate(cb, 'Transaction pool is full');
		} else {
			self.addBundledTransaction(transaction);
		}
	} else if (transaction.type === transactionTypes.MULTI || Array.isArray(transaction.signatures)) {
		if (self.countMultisignature() >= constants.maxTxsPerQueue) {
			return setImmediate(cb, 'Transaction pool is full');
		} else {
			self.addMultisignatureTransaction(transaction);
		}
	} else {
		if (self.countQueued() >= constants.maxTxsPerQueue) {
			return setImmediate(cb, 'Transaction pool is full');
		} else {
			self.addQueuedTransaction(transaction);
		}
	}

	return setImmediate(cb);
};

TransactionPool.prototype.applyUnconfirmedList = function (cb) {
	return __private.applyUnconfirmedList(self.getUnconfirmedTransactionList(true), cb);
};

TransactionPool.prototype.applyUnconfirmedIds = function (ids, cb) {
	return __private.applyUnconfirmedList(ids, cb);
};

TransactionPool.prototype.undoUnconfirmedList = function (cb) {
	var ids = [];

	async.eachSeries(self.getUnconfirmedTransactionList(false), function (transaction, eachSeriesCb) {
		if (transaction) {
			ids.push(transaction.id);
			modules.transactions.undoUnconfirmed(transaction, function (err) {
				if (err) {
					library.logger.error('Failed to undo unconfirmed transaction: ' + transaction.id, err);
					self.removeUnconfirmedTransaction(transaction.id);
				}
				return setImmediate(eachSeriesCb);
			});
		} else {
			return setImmediate(eachSeriesCb);
		}
	}, function (err) {
		return setImmediate(cb, err, ids);
	});
};

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
		return setImmediate(cb, err, ids);
	});
};

TransactionPool.prototype.fillPool = function (cb) {
	if (modules.loader.syncing()) { return setImmediate(cb); }

	var unconfirmedCount = self.countUnconfirmed();
	library.logger.debug('Transaction pool size: ' + unconfirmedCount);

	if (unconfirmedCount >= constants.maxTxsPerBlock) {
		return setImmediate(cb);
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

__private.processVerifyTransaction = function (transaction, broadcast, cb) {
	if (!transaction) {
		return setImmediate(cb, 'Missing transaction');
	}

	async.waterfall([
		function setAccountAndGet (waterCb) {
			modules.accounts.setAccountAndGet({publicKey: transaction.senderPublicKey}, waterCb);
		},
		function verifyTransaction (sender, waterCb) {
			library.logic.transaction.verify(transaction, sender, function (err) {
				if (err) {
					return setImmediate(waterCb, err);
				} else {
					return setImmediate(waterCb, null, sender);
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
						return setImmediate(waterCb, 'Requester not found');
					} else {
						return setImmediate(waterCb, null, sender, requester);
					}
				});
			} else {
				return setImmediate(waterCb, null, sender, null);
			}
		},
		function processTransaction (sender, requester, waterCb) {
			library.logic.transaction.process(transaction, sender, requester, function (err) {
				if (err) {
					return setImmediate(waterCb, err);
				} else {
					return setImmediate(waterCb, null, sender);
				}
			});
		}
	], function (err, sender) {
		if (!err) {
			library.bus.message('unconfirmedTransaction', transaction, broadcast);
		}

		return setImmediate(cb, err, sender);
	});
};

__private.applyUnconfirmedList = function (transactions, cb) {
	async.eachSeries(transactions, function (transaction, eachSeriesCb) {
		if (typeof transaction === 'string') {
			transaction = self.getUnconfirmedTransaction(transaction);
		}
		if (!transaction) {
			return setImmediate(eachSeriesCb);
		}
		__private.processVerifyTransaction(transaction, false, function (err, sender) {
			if (err) {
				library.logger.error('Failed to process / verify unconfirmed transaction: ' + transaction.id, err);
				self.removeUnconfirmedTransaction(transaction.id);
				return setImmediate(eachSeriesCb);
			}
			modules.transactions.applyUnconfirmed(transaction, sender, function (err) {
				if (err) {
					library.logger.error('Failed to apply unconfirmed transaction: ' + transaction.id, err);
					self.removeUnconfirmedTransaction(transaction.id);
				}
				return setImmediate(eachSeriesCb);
			});
		});
	}, cb);
};

__private.transactionTimeOut = function (transaction) {
	if (transaction.type === transactionTypes.MULTI) {
		return (transaction.asset.multisignature.lifetime * 3600);
	} else if (Array.isArray(transaction.signatures)) {
		return (constants.unconfirmedTransactionTimeOut * 8);
	} else {
		return (constants.unconfirmedTransactionTimeOut);
	}
};

__private.expireTransactions = function (transactions, parentIds, cb) {
	var ids = [];

	async.eachSeries(transactions, function (transaction, eachSeriesCb) {
		if (!transaction) {
			return setImmediate(eachSeriesCb);
		}

		var timeNow = new Date();
		var timeOut = __private.transactionTimeOut(transaction);
		var seconds = Math.floor((timeNow.getTime() - new Date(transaction.receivedAt).getTime()) / 1000);

		if (seconds > timeOut) {
			ids.push(transaction.id);
			self.removeUnconfirmedTransaction(transaction.id);
			library.logger.info('Expired transaction: ' + transaction.id + ' received at: ' + transaction.receivedAt.toUTCString());
			return setImmediate(eachSeriesCb);
		} else {
			return setImmediate(eachSeriesCb);
		}
	}, function (err) {
		return setImmediate(cb, err, ids.concat(parentIds));
	});
};

// Export
module.exports = TransactionPool;
