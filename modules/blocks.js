'use strict';

var _ = require('lodash');
var async = require('async');
var BlockReward = require('../logic/blockReward.js');
var ByteBuffer = require('bytebuffer');
var constants = require('../helpers/constants.js');
var crypto = require('crypto');
var genesisblock = null;
var Inserts = require('../helpers/inserts.js');
var ip = require('ip');
var OrderBy = require('../helpers/orderBy.js');
var Router = require('../helpers/router.js');
var schema = require('../schema/blocks.js');
var slots = require('../helpers/slots.js');
var sql = require('../sql/blocks.js');
var transactionTypes = require('../helpers/transactionTypes.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

//Last time received a block
__private.lastReceipt = null;

//Block reward calculation
__private.blockReward = new BlockReward();

//Blockchain is loaded from peers
__private.loaded = false;

//Request for shutdown, please clean/stop your job, will shutdown when isActive = false
__private.cleanup = false;
//To prevent from shutdown if true, that would lead to unstable database state
__private.noShutdownRequired = false;

// @formatter:off
__private.blocksDataFields = {
	'b_id': String,
	'b_version': Number,
	'b_timestamp': Number,
	'b_height': Number,
	'b_previousBlock': String,
	'b_numberOfTransactions': Number,
	'b_totalAmount': String,
	'b_totalFee': String,
	'b_reward': String,
	'b_payloadLength': Number,
	'b_payloadHash': String,
	'b_generatorPublicKey': String,
	'b_blockSignature': String,
	't_id': String,
	't_type': Number,
	't_timestamp': Number,
	't_senderPublicKey': String,
	't_senderId': String,
	't_recipientId': String,
	't_vendorField': String,
	't_amount': String,
	't_fee': String,
	't_signature': String,
	't_signSignature': String,
	's_publicKey': String,
	'd_username': String,
	'v_votes': String,
	'm_min': Number,
	'm_lifetime': Number,
	'm_keysgroup': String,
	't_requesterPublicKey': String,
	't_signatures': String
};
// @formatter:on

// Constructor
function Blocks (cb, scope) {
	library = scope;
	genesisblock = library.genesisblock;
	self = this;

	__private.saveGenesisBlock(function (err) {
		return setImmediate(cb, err, self);
	});
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.map(shared, {
		'get /get': 'getBlock',
		'get /': 'getBlocks',
		'get /getEpoch': 'getEpoch',
		'get /getHeight': 'getHeight',
		'get /getNethash': 'getNethash',
		'get /getFee': 'getFee',
		'get /getFees': 'getFees',
		'get /getMilestone': 'getMilestone',
		'get /getReward': 'getReward',
		'get /getSupply': 'getSupply',
		'get /getStatus': 'getStatus'
	});

	router.use(function (req, res, next) {
		res.status(500).send({success: false, error: 'API endpoint not found'});
	});

	library.network.app.use('/api/blocks', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

__private.saveGenesisBlock = function (cb) {
	library.db.query(sql.getGenesisBlockId, { id: genesisblock.block.id }).then(function (rows) {
		var blockId = rows.length && rows[0].id;

		if (!blockId) {
			__private.saveBlock(genesisblock.block, function (err) {
				return setImmediate(cb, err);
			});
		} else {
			return setImmediate(cb);
		}
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#saveGenesisBlock error');
	});
};

__private.deleteBlock = function (blockId, cb) {
	library.db.none(sql.deleteBlock, {id: blockId}).then(function () {
		return setImmediate(cb);
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#deleteBlock error');
	});
};

__private.list = function (filter, cb) {
	var params = {}, where = [];

	if (filter.generatorPublicKey) {
		where.push('"b_generatorPublicKey"::bytea = ${generatorPublicKey}');
		params.generatorPublicKey = filter.generatorPublicKey;
	}

	if (filter.numberOfTransactions) {
		where.push('"b_numberOfTransactions" = ${numberOfTransactions}');
		params.numberOfTransactions = filter.numberOfTransactions;
	}

	if (filter.previousBlock) {
		where.push('"b_previousBlock" = ${previousBlock}');
		params.previousBlock = filter.previousBlock;
	}

	if (filter.height === 0 || filter.height > 0) {
		where.push('"b_height" = ${height}');
		params.height = filter.height;
	}

	if (filter.totalAmount >= 0) {
		where.push('"b_totalAmount" = ${totalAmount}');
		params.totalAmount = filter.totalAmount;
	}

	if (filter.totalFee >= 0) {
		where.push('"b_totalFee" = ${totalFee}');
		params.totalFee = filter.totalFee;
	}

	if (filter.reward >= 0) {
		where.push('"b_reward" = ${reward}');
		params.reward = filter.reward;
	}

	if (!filter.limit) {
		params.limit = 100;
	} else {
		params.limit = Math.abs(filter.limit);
	}

	if (!filter.offset) {
		params.offset = 0;
	} else {
		params.offset = Math.abs(filter.offset);
	}

	if (params.limit > 100) {
		return setImmediate(cb, 'Invalid limit. Maximum is 100');
	}

	var orderBy = OrderBy(
		(filter.orderBy || 'height:desc'), {
			sortFields: sql.sortFields,
			fieldPrefix: 'b_'
		}
	);

	if (orderBy.error) {
		return setImmediate(cb, orderBy.error);
	}

	library.db.query(sql.countList({
		where: where
	}), params).then(function (rows) {
		var count = rows[0].count;

		library.db.query(sql.list({
			where: where,
			sortField: orderBy.sortField,
			sortMethod: orderBy.sortMethod
		}), params).then(function (rows) {
			var blocks = [];

			for (var i = 0; i < rows.length; i++) {
				blocks.push(library.logic.block.dbRead(rows[i]));
			}

			var data = {
				blocks: blocks,
				count: count
			};

			return setImmediate(cb, null, data);
		}).catch(function (err) {
			library.logger.error(err.stack);
			return setImmediate(cb, 'Blocks#list error');
		});
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#list error');
	});
};

__private.getById = function (id, cb) {
	library.db.query(sql.getById, {id: id}).then(function (rows) {
		if (!rows.length) {
			return setImmediate(cb, 'Block not found');
		}

		var block = library.logic.block.dbRead(rows[0]);

		return setImmediate(cb, null, block);
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#getById error');
	});
};

__private.saveBlock = function (block, cb) {
	library.db.tx(function (t) {
		var promise = library.logic.block.dbSave(block);
		var inserts = new Inserts(promise, promise.values);

		var promises = [
			t.none(inserts.template(), promise.values)
		];

		t = __private.promiseTransactions(t, block, promises);
		t.batch(promises);
	}).then(function () {
		return __private.afterSave(block, cb);
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#saveBlock error');
	});
};

__private.promiseTransactions = function (t, block, blockPromises) {
	if (_.isEmpty(block.transactions)) {
		return t;
	}

	var transactionIterator = function (transaction) {
		transaction.blockId = block.id;
		return library.logic.transaction.dbSave(transaction);
	};

	var promiseGrouper = function (promise) {
		if (promise && promise.table) {
			return promise.table;
		} else {
			throw 'Invalid promise';
		}
	};

	var typeIterator = function (type) {
		var values = [];

		_.each(type, function (promise) {
			if (promise && promise.values) {
				values = values.concat(promise.values);
			} else {
				throw 'Invalid promise';
			}
		});

		var inserts = new Inserts(type[0], values, true);
		t.none(inserts.template(), inserts);
	};

	var promises = _.flatMap(block.transactions, transactionIterator);
	_.each(_.groupBy(promises, promiseGrouper), typeIterator);

	return t;
};

__private.afterSave = function (block, cb) {
	async.eachSeries(block.transactions, function (transaction, cb) {
		return library.logic.transaction.afterSave(transaction, cb);
	}, function (err) {
		return setImmediate(cb, err);
	});
};

__private.getPreviousBlock = function(block, cb){
	var previousBlock = modules.nodeManager.getBlockAtHeight(block.height - 1);
	if(previousBlock && previousBlock.id == block.previousBlock){
		setImmediate(cb, null, previousBlock);
	}
	else { //let's get from database
		library.db.query(sql.getBlockById, {
			id: block.previousBlock
		}).then(function (rows) {
			previousBlock = rows[0];

			//TODO: get this right without tthis cleaning
			previousBlock.reward = parseInt(previousBlock.reward);
			previousBlock.totalAmount = parseInt(previousBlock.totalAmount);
			previousBlock.totalFee = parseInt(previousBlock.totalFee);
			setImmediate(cb, null, previousBlock);
		}).catch(function (err) {
			setImmediate(cb, err);
		});
	}
}

__private.popLastBlock = function (oldLastBlock, cb) {
	library.balancesSequence.add(function (cb) {
		__private.getPreviousBlock(oldLastBlock, function (err, previousBlock) {
			if (err || !previousBlock) {
				return setImmediate(cb, err || 'previousBlock is null');
			}

			async.eachSeries(oldLastBlock.transactions.reverse(), function (transaction, cb) {
				async.series([
					function (cb) {
						modules.transactions.undo(transaction, oldLastBlock, cb);
					}, function (cb) {
						modules.transactions.undoUnconfirmed(transaction, cb);
					}, function (cb) {
						return setImmediate(cb);
					}
				], cb);
			}, function (err) {
				modules.rounds.backwardTick(oldLastBlock, previousBlock, function () {
					__private.deleteBlock(oldLastBlock.id, function (err) {
						library.bus.message("blockRemoved", oldLastBlock, cb);
					});
				});
			});
		});
	}, cb);
};

__private.getIdSequence = function (height, cb) {
	library.db.query(sql.getIdSequence, { height: height, limit: 10, delegates: slots.delegates, activeDelegates: constants.activeDelegates }).then(function (rows) {
		if (rows.length === 0) {
			return setImmediate(cb, 'Failed to get id sequence for height: ' + height);
		}

		var ids = [];

		if (genesisblock && genesisblock.block) {
			var __genesisblock = {
				id: genesisblock.block.id,
				height: genesisblock.block.height
			};

			if (!_.includes(rows, __genesisblock.id)) {
				rows.push(__genesisblock);
			}
		}

		// multithread will eat you
		var lastBlock = modules.nodeManager.getLastBlock();

		if (lastBlock && !_.includes(rows, lastBlock.id)) {
			rows.unshift({
				id: lastBlock.id,
				height: lastBlock.height
			});
		}

		rows.forEach(function (row) {
			if (!_.includes(ids, row.id)) {
				ids.push(row.id);
			}
		});

		return setImmediate(cb, null, { firstHeight: rows[0].height, ids: ids.join(',') });
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#getIdSequence error');
	});
};

__private.readDbRows = function (rows) {
	var blocks = {};
	var order = [];

	for (var i = 0, length = rows.length; i < length; i++) {
		var block = library.logic.block.dbRead(rows[i]);

		if (block) {
			if (!blocks[block.id]) {
				if (block.id === genesisblock.block.id) {
					block.generationSignature = (new Array(65)).join('0');
				}

				order.push(block.id);
				blocks[block.id] = block;
			}

			var transaction = library.logic.transaction.dbRead(rows[i]);
			blocks[block.id].transactions = blocks[block.id].transactions || {};

			if (transaction) {
				if (!blocks[block.id].transactions[transaction.id]) {
					blocks[block.id].transactions[transaction.id] = transaction;
				}
			}
		}
	}

	blocks = order.map(function (v) {
		blocks[v].transactions = Object.keys(blocks[v].transactions).map(function (t) {
			return blocks[v].transactions[t];
		});
		return blocks[v];
	});

	return blocks;
};

__private.applyGenesisTransaction = function (block, transaction, sender, cb) {
	modules.transactions.applyUnconfirmed(transaction, function (err) {
		if (err) {
			return setImmediate(cb, {
				message: err,
				transaction: transaction,
				block: block
			});
		}

		modules.transactions.apply(transaction, block, function (err) {
			if (err) {
				return setImmediate(cb, {
					message: 'Failed to apply transaction: ' + transaction.id,
					transaction: transaction,
					block: block
				});
			}
			return setImmediate(cb);
		});
	});
};

// Public methods
Blocks.prototype.lastReceipt = function (lastReceipt) {
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

Blocks.prototype.getTransactionsFromIds = function(blockid, ids, cb){
	__private.getById(blockid, function (err, block) {
		if (!block || err) {
			return setImmediate(cb, 'Block not found');
		}
		var transactions=[];
		for(var i=0;i<block.transactions.length;i++){
			if(block.transactions[i].id in ids){
				transactions.push[block.transactions[i]];
			}
		}
		return setImmediate(cb, null, transactions);
	});
}

Blocks.prototype.getCommonBlock = function (peer, height, cb) {
	async.waterfall([
		function (waterCb) {
			__private.getIdSequence(height, function (err, res) {
				return setImmediate(waterCb, err, res);
			});
		},
		function (res, waterCb) {
			var ids = res.ids;

			modules.transport.getFromPeer(peer, {
				api: '/blocks/common?ids=' + ids,
				method: 'GET'
			}, function (err, res) {
				if (err || res.body.error) {
					return setImmediate(waterCb, err || res.body.error.toString());
				} else if (!res.body.common) {
					return setImmediate(waterCb, ['Chain comparison failed with peer:', peer.string, 'using ids:', ids].join(' '));
				} else {
					return setImmediate(waterCb, null, res);
				}
			});
		},
		function (res, waterCb) {
			library.db.query(sql.getCommonBlock(res.body.common.previousBlock), {
				id: res.body.common.id,
				previousBlock: res.body.common.previousBlock,
				height: res.body.common.height
			}).then(function (rows) {
				if (!rows.length || !rows[0].count) {
					return setImmediate(waterCb, ['Chain comparison failed with peer:', peer.string, 'using block:', JSON.stringify(res.body.common)].join(' '));
				} else {
					return setImmediate(waterCb, null, res.body.common);
				}
			}).catch(function (err) {
				library.logger.error(err.stack);
				return setImmediate(waterCb, 'Blocks#getCommonBlock error');
			});
		}
	], function (err, res) {
		return setImmediate(cb, err, res);
	});
};

Blocks.prototype.count = function (cb) {
	library.db.query(sql.countByRowId).then(function (rows) {
		var res = rows.length ? rows[0].count : 0;

		return setImmediate(cb, null, res);
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#count error');
	});
};

Blocks.prototype.loadBlocksData = function (filter, options, cb) {
	if (arguments.length < 3) {
		cb = options;
		options = {};
	}

	options = options || {};

	var params = { limit: filter.limit || 1 };

	if (filter.id && filter.lastId) {
		return setImmediate(cb, 'Invalid filter: Received both id and lastId');
	} else if (filter.id) {
		params.id = filter.id;
	} else if (filter.lastId) {
		params.lastId = filter.lastId;
	}

	var fields = __private.blocksDataFields;

	library.dbSequence.add(function (cb) {
		library.db.query(sql.getHeightByLastId, { lastId: filter.lastId || null }).then(function (rows) {

			var height = rows.length ? rows[0].height : 0;
			var realLimit = height + (parseInt(filter.limit) || 1);

			params.limit = realLimit;
			params.height = height;

			library.db.query(sql.loadBlocksData(filter), params).then(function (rows) {
				return setImmediate(cb, null, rows);
			});
		}).catch(function (err ) {
			library.logger.error(err.stack);
			return setImmediate(cb, 'Blocks#loadBlockData error');
		});
	}, cb);
};

Blocks.prototype.loadBlocksPart = function (filter, cb) {
	self.loadBlocksData(filter, function (err, rows) {
		var blocks = [];

		if (!err) {
			blocks = __private.readDbRows(rows);
		}

		return setImmediate(cb, err, blocks);
	});
};

Blocks.prototype.loadBlocksOffset = function (limit, offset, verify, cb) {
	var newLimit = limit + (offset || 0);
	var params = { limit: newLimit, offset: offset || 0 };

	library.logger.debug('Loading blocks offset', {limit: limit, offset: offset, verify: verify});
	library.dbSequence.add(function (cb) {
		var lastBlock;
		library.db.query(sql.loadBlocksOffset, params).then(function (rows) {
			var blocks = __private.readDbRows(rows);

			async.eachSeries(blocks, function (block, cb) {
				if (__private.cleanup) {
					return setImmediate(cb);
				}

				library.logger.debug('Processing block', block.height);
				if (verify && block.id !== genesisblock.block.id) {
					// Sanity check of the block, if values are coherent.
					// No access to database.
					var check = self.verifyBlock(block, lastBlock);

					if (!check.verified) {
						library.logger.error(['loadBlocksOffset: Block ', block.id, 'verification failed'].join(' '), check.errors.join(', '));
						return setImmediate(cb, check.errors[0]);
					}
				}
				block.verified = true;
				block.processed = true;
				if (block.id === genesisblock.block.id) {
					__private.applyGenesisBlock(block, cb);
				}
				else {
					async.waterfall([
						function(cb){
							if(block.numberOfTransactions>0){
								__private.applyBlock(block, cb);
							}
							else{
								setImmediate(cb);
							}
						},
						function(cb){
							modules.rounds.tick(block, cb);
						}
					],cb);
				}
				lastBlock = block;
			}, function (err) {
				return setImmediate(cb, err, lastBlock);
			});
		}).catch(function (err) {
			library.logger.error(err.stack);
			return setImmediate(cb, 'Blocks#loadBlocksOffset error');
		});
	}, cb);
};

Blocks.prototype.removeSomeBlocks = function(numbers, cb){
	if (modules.nodeManager.getLastBlock().height === 1) {
		return setImmediate(cb);
	}

	library.blockSequence.add(function (cb){
		// Don't shutdown now
		__private.noShutdownRequired = true;

		async.series({
			// Rewind any unconfirmed transactions before removing blocks.
			// We won't apply them again since we will have to resync blocks back from network
			undoUnconfirmedList: function (seriesCb) {
				modules.transactionPool.undoUnconfirmedList([],function (err, transactions) {
					if (err) {
						// TODO: Send a numbered signal to be caught by forever to trigger a rebuild.
						return setImmediate(seriesCb, err);
					} else {
						return setImmediate(seriesCb);
					}
				});
			},
			backwardSwap: function (seriesCb) {
				modules.rounds.directionSwap('backward', null, seriesCb);
			},
	   	popLastBlock: function (seriesCb) {
				async.whilst(
					function () {
						//if numbers = 50, on average remove 50 Blocks, roughly 1 round
						return (Math.random() > 1/(numbers+1));
					},
					function (next) {
						var block = modules.nodeManager.getLastBlock();
						__private.popLastBlock(block, function (err, newLastBlock) {
			   			if (err) {
			   				library.logger.error('Error deleting last block', block);
								library.logger.error('Error deleting last block', err);
			   			}
			   			next(err);
			   		});
					},
					function (err) {
						return setImmediate(seriesCb, err);
					}
				);
	   	},
			forwardSwap: function (seriesCb) {
			 	modules.rounds.directionSwap('forward', modules.nodeManager.getLastBlock(), seriesCb);
			}
		}, function (err) {
			// Reset the last receipt
			self.lastReceipt(new Date());
			// Allow shutdown, database writes are finished.
			__private.noShutdownRequired = false;
			return setImmediate(cb, err);
		});
	}, cb);
}



Blocks.prototype.removeLastBlock = function(cb){
	if (modules.nodeManager.getLastBlock().height === 1) {
		return setImmediate(cb);
	}
	// one block after the other
	library.blockSequence.add(function (cb){

		// Don't shutdown now
		__private.noShutdownRequired = true;

		async.series({
			// Rewind any unconfirmed transactions before removing blocks.
			// We won't apply them again since we will have to resync blocks back from network
			undoUnconfirmedList: function (seriesCb) {
				modules.transactionPool.undoUnconfirmedList([],function (err, transactions) {
					return setImmediate(seriesCb, err);

				});
			},
			backwardSwap: function (seriesCb) {
				modules.rounds.directionSwap('backward', null, seriesCb);
			},
	   	popLastBlock: function (seriesCb) {
				var block = modules.nodeManager.getLastBlock();
				__private.popLastBlock(block, function (err, newLastBlock) {
					if (err) {
						library.logger.error('Error deleting last block', block);
						library.logger.error('Error deleting last block', err);
					}
					return setImmediate(cb, err);
				});
	   	},
			forwardSwap: function (seriesCb) {
			 	modules.rounds.directionSwap('forward', modules.nodeManager.getLastBlock(), seriesCb);
			}
		}, function (err) {
			// Reset the last receipt
			self.lastReceipt(new Date());
			// Allow shutdown, database writes are finished.
			__private.noShutdownRequired = false;
			return setImmediate(cb, err);
		});
	}, cb);
}

Blocks.prototype.loadLastBlock = function (cb) {
	library.dbSequence.add(function (cb) {
		library.db.query(sql.loadLastBlock).then(function (rows) {
			var block = __private.readDbRows(rows)[0];

			block.transactions = block.transactions.sort(function (a, b) {
				if (block.id === genesisblock.block.id) {
					if (a.type === transactionTypes.VOTE) {
						return 1;
					}
				}

				if (a.type === transactionTypes.SIGNATURE) {
					return 1;
				}

				return 0;
			});
			return setImmediate(cb, null, block);
		}).catch(function (err) {
			library.logger.error(err.stack);
			return setImmediate(cb, 'Blocks#loadLastBlock error');
		});
	}, cb);
};

Blocks.prototype.getLastBlock = function () {
	var lastBlock = modules.nodeManager.getLastBlock();

	if (lastBlock) {
		var epoch = constants.epochTime / 1000;
		var lastBlockTime = epoch + lastBlock.timestamp;
		var currentTime = new Date().getTime() / 1000;

		lastBlock.secondsAgo = currentTime - lastBlockTime;
		lastBlock.fresh = (lastBlock.secondsAgo < 120);
	}

	return lastBlock;
};

Blocks.prototype.onVerifyBlock = function (block, cb) {
	var result = self.verifyBlock(block, false);
	if(result.verified){
		library.bus.message("blockVerified",block, cb);
	}
	else{
		setImmediate(cb, result.errors.join(" - "), block);
	}
}

// Will return all possible errors that are intrinsic to the block.
// NO DATABASE access
// skipLastBlockCheck: to check any block, and not check if we have the next block of the internal chain
Blocks.prototype.verifyBlock = function (block, lastBlock) {
	var result = { verified: false, errors: [] };

	try {
		block = library.logic.block.objectNormalize(block);
	} catch (err) {
		result.errors.push(err);
	}

	if(!block.id){
		result.errors.push("No block id");
	}

	if (!block.previousBlock && block.height !== 1) {
		result.errors.push('Invalid previous block');
	} else if (lastBlock && block.previousBlock !== lastBlock.id) {
		// Fork: Same height but different previous block id.
		library.bus.message("fork",block, 1);
		result.errors.push(['Invalid previous block:', block.previousBlock, 'expected:', lastBlock.id].join(' '));
	}

	var expectedReward = __private.blockReward.calcReward(block.height);

	if (block.height !== 1 && expectedReward !== block.reward) {
		result.errors.push(['Invalid block reward:', block.reward, 'expected:', expectedReward].join(' '));
	}

	var valid;

	try {
		valid = library.logic.block.verifySignature(block);
	} catch (e) {
		result.errors.push(e.toString());
	}

	if (!valid) {
		result.errors.push('Failed to verify block signature');
	}

	if (block.version > 0) {
		result.errors.push('Invalid block version');
	}

	var blockSlotNumber = slots.getSlotNumber(block.timestamp);


	if (blockSlotNumber > slots.getSlotNumber()){
		result.errors.push('Invalid block timestamp');
	}
	if(lastBlock){
		var lastBlockSlotNumber = slots.getSlotNumber(lastBlock.timestamp);
		if(blockSlotNumber <= lastBlockSlotNumber) {
		 	result.errors.push('Invalid block timestamp');
		}
	}


	if (block.payloadLength > constants.maxPayloadLength) {
		result.errors.push('Payload length is too high');
	}

	if (block.transactions.length !== block.numberOfTransactions) {
		result.errors.push('Invalid number of transactions');
	}

	if (block.transactions.length > constants.maxTxsPerBlock) {
		result.errors.push('Transactions length is too high');
	}

	// Checking if transactions of the block adds up to block values.
	var totalAmount = 0,
	    totalFee = 0,
			size = 0,
	    payloadHash = crypto.createHash('sha256'),
	    appliedTransactions = {};

	var transactions = block.transactions;

	for (var i in transactions) {
		var transaction = transactions[i];
		var bytes;

		try {
			bytes = library.logic.transaction.getBytes(transaction);
		} catch (e) {
			result.errors.push(e.toString());
		}

		if (size + bytes.length > constants.maxPayloadLength) {
			result.errors.push("Payload is too large");
		}

		size += bytes.length;

		if (appliedTransactions[transaction.id]) {
			result.errors.push('Encountered duplicate transaction: ' + transaction.id);
		}

		appliedTransactions[transaction.id] = transaction;
		if (bytes) { payloadHash.update(bytes); }
		totalAmount += transaction.amount;
		totalFee += transaction.fee;
	}


	var calculatedHash=payloadHash.digest().toString('hex');
	if (calculatedHash !== block.payloadHash) {
		result.errors.push('Invalid payload hash');
	}

	if (totalAmount !== block.totalAmount) {
		result.errors.push('Invalid total amount');
	}

	if (totalFee !== block.totalFee) {
		result.errors.push('Invalid total fee');
	}

	result.verified = result.errors.length === 0;
	return result;
};

// Apply the block, provided it has been verified.
__private.applyBlock = function (block, cb) {

	// Prevent shutdown during database writes.
	__private.noShutdownRequired = true;

	// Transactions to rewind in case of error.
	var appliedTransactions = {};

	// List of currrently unconfirmed transactions that have been popped and unconfirmed transactions from the block already present in the node
	var removedTransactionsIds, keptTransactions;


	async.series({
		// Rewind any unconfirmed transactions before applying block.
		// TODO: It should be possible to remove this call if we can guarantee that only this function is processing transactions atomically. Then speed should be improved further.
		// TODO: Other possibility, when we rebuild from block chain this action should be moved out of the rebuild function.
		undoUnconfirmedList: function (seriesCb) {
			modules.transactionPool.undoUnconfirmedList(block.transactions, function (err, removedTransactionsIds, keptTransactionsIds) {
				if (err) {
					return setImmediate(seriesCb, err);
				} else {
					removedTransactionsIds = removedTransactionsIds;
					keptTransactions = block.transactions.filter(function(tx){
						return keptTransactionsIds.indexOf(tx.id) == -1;
					});
					return setImmediate(seriesCb);
				}
			});
		},
		// Apply transactions to unconfirmed mem_accounts fields.
		applyUnconfirmed: function (seriesCb) {
			async.eachSeries(keptTransactions, function (transaction, eachSeriesCb) {
				// DATABASE: write
				modules.transactions.applyUnconfirmed(transaction, function (err) {
					if (err) {
						err = ['Failed to apply transaction:', transaction.id, '-', err].join(' ');
						library.logger.error(err);
						library.logger.error('Transaction', transaction);
						return setImmediate(eachSeriesCb, err);
					}

					appliedTransactions[transaction.id] = transaction;

					return setImmediate(eachSeriesCb);
				});
			}, function (err) {
				if (err) {
					// Rewind any already applied unconfirmed transactions.
					// Leaves the database state as per the previous block.
					async.eachSeries(block.transactions, function (transaction, eachSeriesCb) {
						// The transaction has been applied?
						if (appliedTransactions[transaction.id]) {
							// DATABASE: write
							modules.transactions.undoUnconfirmed(transaction, eachSeriesCb);
						} else {
							return setImmediate(eachSeriesCb);
						}
					}, function (err) {
						return setImmediate(seriesCb, err);
					});
				} else {
					return setImmediate(seriesCb);
				}
			});
		},
		// Block and transactions are ok.
		// Apply transactions to confirmed mem_accounts fields.
		applyConfirmed: function (seriesCb) {
			async.eachSeries(block.transactions, function (transaction, eachSeriesCb) {
				// DATABASE: write
				modules.transactions.apply(transaction, block, function (err) {
					if (err) {
						err = ['Failed to apply transaction:', transaction.id, '-', err].join(' ');
						library.logger.error(err);
						library.logger.error('Transaction', transaction);
						// TODO: Send a numbered signal to be caught by forever to trigger a rebuild.
						return setImmediate(eachSeriesCb, err);
					}
					// Transaction applied, removed from the unconfirmed list.
					modules.transactionPool.removeUnconfirmedTransaction(transaction.id);
					return setImmediate(eachSeriesCb);
				});
			}, function (err) {
				return setImmediate(seriesCb, err);
			});
		}
	}, function (err) {
		// Allow shutdown, database writes are finished.
		__private.noShutdownRequired = false;

		// Nullify large objects.
		// Prevents memory leak during synchronisation.
		keptTransactions = appliedTransactions = removedTransactionsIds = block = null;

		return setImmediate(cb, err);
	});
};

// Apply the genesis block, provided it has been verified.
// Shortcuting the unconfirmed/confirmed states.
__private.applyGenesisBlock = function (block, cb) {
	block.transactions = block.transactions.sort(function (a, b) {
		if (a.type === transactionTypes.VOTE) {
			return 1;
		} else {
			return 0;
		}
	});
	async.eachSeries(block.transactions, function (transaction, cb) {
			modules.accounts.setAccountAndGet({publicKey: transaction.senderPublicKey}, function (err, sender) {
				if (err) {
					return setImmediate(cb, {
						message: err,
						transaction: transaction,
						block: block
					});
				}
				__private.applyGenesisTransaction(block, transaction, sender, cb);
			});
	}, function (err) {
		if (err) {
			// If genesis block is invalid, kill the node...
			library.logger.error(err);
			return process.exit(0);
		} else {
			modules.rounds.tick(block, cb);
		}
	});
};

// Main function to process a Verified Block.
// * Verify the block is compatible with database state (DATABASE readonly)
// * Apply the block to database if both verifications are ok
Blocks.prototype.processBlock = function (block, cb) {
	if (__private.cleanup) {
		return setImmediate(cb, 'Cleaning up');
	}

	// be sure to apply only one block after the other
	library.blockSequence.add(function (cb){



		// Sanity check of the block, if values are coherent.
		// No access to database
		// var check = self.verifyBlock(block);

		// if (!check.verified) {
		// 	library.logger.error(['Block', block.id, 'verification failed'].join(' '), check.errors.join(', '));
		// 	library.logger.debug("block", block);
		// 	return setImmediate(cb, check.errors[0]);
		// }


		// Check if block id is already in the database (very low probability of hash collision).
		// TODO: In case of hash-collision, to me it would be a special autofork...
		// DATABASE: read only
		library.db.query(sql.getBlockId, { id: block.id }).then(function (rows) {
			if (rows.length > 0) {
				return setImmediate(cb, ['Block', block.id, 'already exists'].join(' '));
			}

			// Check if block was generated by the right active delagate. Otherwise, fork 3.
			// DATABASE: Read only to mem_accounts to extract active delegate list
			modules.delegates.validateBlockSlot(block, function (err) {
				if (err) {
					library.bus.message("fork",block, 3);
					return setImmediate(cb, err);
				}

				// Check against the mem_* tables that we can perform the transactions included in the block.
				async.eachSeries(block.transactions, function (transaction, cb) {
					async.waterfall([
						function (cb) {
							// Removed LOC because it makes no sense
							// try {
							// 	transaction.id = library.logic.transaction.getId(transaction);
							// } catch (e) {
							// 	return setImmediate(cb, e.toString());
							// }
							transaction.blockId = block.id;
							// Check if transaction is already in database, otherwise fork 2.
							// TODO: Uncle forging: Double inclusion is allowed.
							// DATABASE: read only
							library.db.query(sql.getTransactionId, { id: transaction.id }).then(function (rows) {
								if (rows.length > 0) {
									library.bus.message("fork",block, 2);
									library.logger.error("error existing tx", block);
									library.logger.error("error existing tx", rows);
									return setImmediate(cb, ['Transaction', transaction.id, 'already exists'].join(' '));
								} else {
									// Get account from database if any (otherwise cold wallet).
									// DATABASE: read only
									modules.accounts.getAccount({publicKey: transaction.senderPublicKey}, cb);
								}
							}).catch(function (err) {
								library.logger.error(err.stack);
								return setImmediate(cb, 'Blocks#processBlock error');
							});
						},
						function (sender, cb) {
							// Check if transaction id valid against database state (mem_* tables).
							// DATABASE: read only
							if(block.height!=1){
								library.logic.transaction.verify(transaction, sender, cb);
							}
							else{
								// Don't verify transaction in Genesis block unless there is a signature
								if(transaction.signature){
									library.logic.transaction.verify(transaction, sender, cb);
								}
								else {
									return setImmediate(cb);
								}

							}
						}
					],
					function (err) {
						return setImmediate(cb, err);
					});
				},
				function (err) {
					if (err) {
						return setImmediate(cb, err);
					} else {
						// The block and the transactions are OK i.e:
						// * Block and transactions have valid values (signatures, block slots, etc...)
						// * The check against database state passed (for instance sender has enough ARK, votes are under 101, etc...)
						// We thus update the database with the transactions values, save the block and tick it.
						async.waterfall([
							function(cb){
								__private.applyBlock(block, cb);
							},
							function(cb){
								__private.saveBlock(block, cb);
							},
							function(cb){
								modules.rounds.tick(block, cb);
							}
						],cb);
					}
				});
			});
		});
	}, cb);
};

Blocks.prototype.processEmptyBlock = function (block, cb) {
	if (__private.cleanup) {
		return setImmediate(cb, 'Cleaning up');
	}
	if(block.numberOfTransactions>0){
		return setImmediate(cb, 'Not an empty block');
	}

	// be sure to apply only one block after the other
	library.blockSequence.add(function (cb){

		// Check if block id is already in the database (very low probability of hash collision).
		// TODO: In case of hash-collision, to me it would be a special autofork...
		// DATABASE: read only
		library.db.query(sql.getBlockId, { id: block.id }).then(function (rows) {
			if (rows.length > 0) {
				return setImmediate(cb, ['Block', block.id, 'already exists'].join(' '));
			}

			// Check if block was generated by the right active delagate. Otherwise, fork 3.
			// DATABASE: Read only to mem_accounts to extract active delegate list
			modules.delegates.validateBlockSlot(block, function (err) {
				if (err) {
					library.bus.message("fork",block, 3);
					return setImmediate(cb, err);
				}

				async.waterfall([
					function(cb){
						__private.saveBlock(block, cb);
					},
					function(cb){
						modules.rounds.tick(block, cb);
					},
				],cb);
			});
		});
	}, cb);
};

Blocks.prototype.simpleDeleteAfterBlock = function (blockId, cb) {
	library.db.query(sql.simpleDeleteAfterBlock, {id: blockId}).then(function (res) {
		return setImmediate(cb, null, res);
	}).catch(function (err) {
		library.logger.error(err.stack);
		return setImmediate(cb, 'Blocks#simpleDeleteAfterBlock error');
	});
};

Blocks.prototype.loadBlocksFromPeer = function (peer, cb) {
	var lastValidBlock = modules.nodeManager.getLastBlock();

	peer = modules.peers.inspect(peer);
	library.logger.info('Loading blocks from: ' + peer.string);

	modules.transport.getFromPeer(peer, {
		method: 'GET',
		api: '/blocks?lastBlockHeight=' + lastValidBlock.height
	}, function (err, res) {
		if (err || res.body.error) {
			return setImmediate(cb, err, lastValidBlock);
		}
		var blocks = res.body.blocks;
		// update with last version of peer data (height, blockheader)
		if(res.peer){
			peer=res.peer;
		}

		//library.logger.debug('loaded blocks',blocks);

		var report = library.schema.validate(res.body.blocks, schema.loadBlocksFromPeer);

		if (!report) {
			return setImmediate(cb, 'Received invalid blocks data', lastValidBlock);
		}

		if (blocks.length === 0) {
			return setImmediate(cb, null, lastValidBlock);
		} else {
			library.bus.message("blocksReceived", blocks, peer, cb);

			// async.eachSeries(blocks, function (block, cb) {
			// 	if (__private.cleanup) {
			// 		return setImmediate(cb);
			// 	}
			// 	library.bus.message("blockReceived", block, peer, function(err){
			// 		return cb(err);
			// 	});

				// block.reward=parseInt(block.reward);
				// block.totalAmount=parseInt(block.totalAmount);
				// block.totalFee=parseInt(block.totalFee);
				// self.processBlock(block, function (err) {
				// 	if (!err) {
				// 		self.lastReceipt(new Date());
				// 		lastValidBlock = block;
				// 		library.logger.info(['Block', block.id, 'loaded from:', peer.string, "transactions:", block.numberOfTransactions].join(' '), 'height: ' + block.height);
				// 	} else {
				// 		var id = (block ? block.id : 'null');
				// 		library.logger.error(['Block', id].join(' '), err.toString());
				// 		if (block) { library.logger.error('Block', block); }
				//
				// 		library.logger.warn(['Block', id, 'is not valid, ban 60 min'].join(' '), peer.string);
				// 		modules.peers.state(peer.ip, peer.port, 0, 3600);
				// 	}
				// 	return cb(err);
				// });
			// }, function (err) {
			// 	// Nullify large array of blocks.
			// 	// Prevents memory leak during synchronisation.
			// 	res = blocks = null;
			//
			// 	if (err) {
			// 		return setImmediate(cb, 'Error loading blocks: ' + (err.message || err), lastValidBlock);
			// 	} else {
			// 		return setImmediate(cb, null, lastValidBlock);
			// 	}
			// });
		}
	});
};


Blocks.prototype.deleteBlocksBefore = function (block, cb) {
	var blocks = [];


	async.whilst(
		function () {
			return (block.height < lastBlock.height);
		},
		function (next) {
			blocks.unshift(lastBlock);
			__private.popLastBlock(modules.nodeManager.getLastBlock(), function (err, newLastBlock) {
				if(err){
					library.logger.error('error removing block', block);
					library.logger.error('error removing block', err);
				}

				library.logger.debug('removing block', block);
				next(err);
			});
		},
		function (err) {
			// reset the last receipt and try to rebuild now
			self.lastReceipt(new Date());
			return setImmediate(cb, err, blocks);
		}
	);
};

Blocks.prototype.generateBlock = function (keypair, timestamp, cb) {
	var transactions = modules.transactionPool.getUnconfirmedTransactionList(false, constants.maxTxsPerBlock);
	var ready = [];
	async.eachSeries(transactions, function (transaction, cb) {

		if(!transaction){
			library.logger.debug('no tx!!!');
			return setImmediate(cb);
		}
		// Check if tx id is already in blockchain
		library.db.query(sql.getTransactionId, { id: transaction.id }).then(function (rows) {
			if (rows.length > 0) {
				modules.transactionPool.removeUnconfirmedTransaction(transaction.id);
				library.logger.debug('removing tx from unconfirmed', transaction.id);
				return setImmediate(cb, 'Transaction ID is already in blockchain - ' + transaction.id);
			}
			modules.accounts.getAccount({ publicKey: transaction.senderPublicKey }, function (err, sender) {
				if (err || !sender) {
					return setImmediate(cb, 'Sender not found');
				}

				if (library.logic.transaction.ready(transaction, sender)) {
					library.logic.transaction.verify(transaction, sender, function (err) {
						ready.push(transaction);
						return setImmediate(cb);
					});
				} else {
					return setImmediate(cb);
				}
			});
		});
	}, function () {
		var block;

		try {
			block = library.logic.block.create({
				keypair: keypair,
				timestamp: timestamp,
				//TODO: fireworks!
				previousBlock: modules.nodeManager.getLastBlock(),
				transactions: ready
			});
		} catch (e) {
			library.logger.error(e.stack);
			return setImmediate(cb, e);
		}

		setImmediate(cb, null, block);
		//self.processBlock(block, true, cb, true);
	});
};



// Events
Blocks.prototype.onProcessBlock = function (block, cb) {
	if(block.numberOfTransactions == 0){
		self.processEmptyBlock(block, function(err){
			if (err) {
				cb && setImmediate(cb, err, block);
			}
			else{
				library.bus.message("blockProcessed", block, cb);
			}
		});
	}
	else{
		self.processBlock(block, function(err){
			if (err) {
				cb && setImmediate(cb, err, block);
			}
			else{
				library.bus.message("blockProcessed", block, cb);
			}
		});
	}
};


Blocks.prototype.onBind = function (scope) {
	modules = scope;
};


Blocks.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};


Blocks.prototype.cleanup = function (cb) {
	__private.cleanup = true;

	if (!__private.noShutdownRequired) {
		return setImmediate(cb);
	} else {
		setImmediate(function nextWatch () {
			if (__private.noShutdownRequired) {
				library.logger.info('Waiting for block processing to finish...');
				setTimeout(nextWatch, 1 * 1000);
			} else {
				return setImmediate(cb);
			}
		});
	}
};

// Shared public API
shared.getBlock = function (req, cb) {

	library.schema.validate(req.body, schema.getBlock, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		library.dbSequence.add(function (cb) {
			__private.getById(req.body.id, function (err, block) {
				if (!block || err) {
					return setImmediate(cb, 'Block not found');
				}
				return setImmediate(cb, null, {block: block});
			});
		}, cb);
	});
};

shared.getBlocks = function (req, cb) {

	library.schema.validate(req.body, schema.getBlocks, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		library.dbSequence.add(function (cb) {
			__private.list(req.body, function (err, data) {
				if (err) {
					return setImmediate(cb, err);
				}
				return setImmediate(cb, null, {blocks: data.blocks, count: data.count});
			});
		}, cb);
	});
};

shared.getEpoch = function (req, cb) {

	return setImmediate(cb, null, {epoch: constants.epochTime});
};

shared.getHeight = function (req, cb) {
	var block=modules.nodeManager.getLastBlock();

	return setImmediate(cb, null, {height: block.height, id:block.id});
};

shared.getFee = function (req, cb) {

	return setImmediate(cb, null, {fee: library.logic.block.calculateFee()});
};

shared.getFees = function (req, cb) {

	return setImmediate(cb, null, {fees: constants.fees});
};

shared.getNethash = function (req, cb) {

	return setImmediate(cb, null, {nethash: library.config.nethash});
};

shared.getMilestone = function (req, cb) {
	return setImmediate(cb, null, {milestone: __private.blockReward.calcMilestone(modules.nodeManager.getLastBlock().height)});
};

shared.getReward = function (req, cb) {
	return setImmediate(cb, null, {reward: __private.blockReward.calcReward(modules.nodeManager.getLastBlock().height)});
};

shared.getSupply = function (req, cb) {
	return setImmediate(cb, null, {supply: __private.blockReward.calcSupply(modules.nodeManager.getLastBlock().height)});
};

shared.getStatus = function (req, cb) {

	var block = modules.nodeManager.getLastBlock();

	return setImmediate(cb, null, {
		epoch:     constants.epochTime,
		height:    block.height,
		fee:       library.logic.block.calculateFee(),
		milestone: __private.blockReward.calcMilestone(block.height),
		nethash:   library.config.nethash,
		reward:    __private.blockReward.calcReward(block.height),
		supply:    __private.blockReward.calcSupply(block.height)
	});
};

// Export
module.exports = Blocks;
