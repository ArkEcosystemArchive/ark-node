'use strict';

var async = require('async');
var bignum = require('../helpers/bignum.js');
var constants = require('../helpers/constants.js');
var ip = require('ip');
var Router = require('../helpers/router.js');
var schema = require('../schema/loader.js');
var sql = require('../sql/loader.js');

require('colors');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.network = {
	height: 0, // Network height
	peers: [], // "Good" peers and with height close to network height
};

__private.blockchainReady = false;
__private.noShutdownRequired = false;
__private.lastBlock = null;
__private.genesisBlock = null;
__private.forceRemoveBlocks = 0;
__private.total = 0;
__private.blocksToSync = 0;
__private.syncFromNetworkIntervalId = null;

// Constructor
function Loader (cb, scope) {
	library = scope;
	self = this;

	__private.genesisBlock = __private.lastBlock = library.genesisblock;

	return cb(null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.get('/status/ping', function (req, res) {
		__private.ping(function(status, body) {
			return res.status(status).json(body);
		});
	});

	router.map(shared, {
		'get /status': 'status',
		'get /status/sync': 'sync',
		'get /autoconfigure': 'autoconfigure'
	});

	library.network.app.use('/api/loader', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

__private.syncFromNetworkTrigger = function (turnOn) {
	__private.noShutdownRequired = turnOn;

	if (!turnOn && __private.syncFromNetworkIntervalId) {
		clearTimeout(__private.syncFromNetworkIntervalId);
		__private.syncFromNetworkIntervalId = null;
	}
	if (turnOn && !__private.syncFromNetworkIntervalId) {
		setImmediate(function nextSyncTrigger () {
			library.network.io.sockets.emit('loader/sync', {
				blocks: __private.blocksToSync,
				height: modules.blocks.getLastBlock().height
			});
			__private.syncFromNetworkIntervalId = setTimeout(nextSyncTrigger, 1000);
		});
	}
};
//
// __private.loadSignatures = function (cb) {
// 	modules.transport.requestFromRandomPeer({
// 		api: '/signatures',
// 		method: 'GET'
// 	}, function (err, res) {
// 		if (err) {
// 			return cb();
// 		}
//
// 		library.schema.validate(res.body, schema.loadSignatures, function (err) {
// 			if (err) {
// 				return cb();
// 			}
//
// 			library.sequence.add(function (cb) {
// 				async.eachSeries(res.body.signatures, function (signature, cb) {
// 					async.eachSeries(signature.signatures, function (s, cb) {
// 						modules.multisignatures.processSignature({
// 							signature: s,
// 							transaction: signature.transaction
// 						}, function (err) {
// 							return cb();
// 						});
// 					}, cb);
// 				}, cb);
// 			}, cb);
// 		});
// 	});
// };

__private.loadUnconfirmedTransactions = function (cb) {
	modules.transport.requestFromRandomPeer({
		api: '/transactions',
		method: 'GET'
	}, function (err, res) {
		if (err) {
			return cb(err);
		}

		var report = library.schema.validate(res.body, schema.loadUnconfirmedTransactions);

		if (!report) {
			return cb("Transactions list is not conform");
		}

		var transactions = res.body.transactions;

		library.bus.message("transactionsReceived", transactions, "network", cb);

	});
};

__private.loadBlockChain = function () {

	var offset = 0, limit = Number(library.config.loading.loadPerIteration) || 1000;
	var verify = Boolean(library.config.loading.verifyOnLoading);

	function load (count) {
		verify = true;
		__private.total = count;

		library.logic.account.removeTables(function (err) {
			if (err) {
				throw err;
			} else {
				library.logic.account.createTables(function (err) {
					if (err) {
						throw err;
					} else {
						async.until(
							function () {
								return count < offset;
							},
							function (cb) {
								if (count > 1) {
									library.logger.info('Rebuilding blockchain, current block height: '  + (offset + 1));
								}
								modules.blocks.loadBlocksOffset(limit, offset, verify, function (err, lastBlock) {
									offset = offset + limit;
									__private.lastBlock = lastBlock;
									return cb(err, lastBlock);
								});
							},
							function (err, lastBlock) {
								if (err) {
									library.logger.error("error:",err);
									if (__private.lastBlock) {
										library.logger.error('Blockchain failed at: ' + __private.lastBlock.height);
										modules.blocks.simpleDeleteAfterBlock(__private.lastBlock.id, function (err, res) {
											library.logger.error('Blockchain clipped');
										});
									}
								}
								library.bus.message('databaseLoaded', __private.lastBlock);
							}
						);
					}
				});
			}
		});
	}

	function reload (count, message) {
		if (message) {
			library.logger.warn(message);
			library.logger.warn('Recreating memory tables');
		}
		load(count);
	}

	// Reset unconfirmed columns in mem_accounts
	library.db.none(sql.resetMemAccounts);

	// Count the number of blocks in database. Start build if only 1.
	// Otherwise try to get some blocks from
	library.db.query(sql.countBlocks).then(function(rows){

		if(rows[0].count == 1){
			load(rows[0].count);
		}
		else {
			modules.blocks.loadLastBlock(function (err, block) {
				if (err) {
					return reload(count, err || 'Failed to load last block');
				} else {
					__private.lastBlock = block;
					library.bus.message('databaseLoaded', block);
				}
			});
		}
	});

	//
	// function checkMemTables (t) {
	// 	var promises = [
	// 		t.one(sql.countBlocks),
	// 		t.one(sql.countMemAccounts),
	// 		t.query(sql.getMemRounds)
	// 	];
	//
	// 	return t.batch(promises);
	// }
	//
	// library.db.task(checkMemTables).then(function (results) {
	// 	library.logger.info('checkMemTables', results);
	// 	var count = results[0].count;
	// 	var missed = !(results[1].count);
	//
	// 	library.logger.info('Blocks ' + count);
	//
	// 	var round = modules.rounds.getRoundFromHeight(count);
	//
	// 	if (library.config.loading.snapshot !== undefined || library.config.loading.snapshot > 0) {
	// 		library.logger.info('Snapshot mode enabled');
	// 		verify = true;
	//
	// 		if (isNaN(library.config.loading.snapshot) || library.config.loading.snapshot >= round) {
	// 			library.config.loading.snapshot = round;
	//
	// 			if ((count === 1) || (count % constants.activeDelegates > 0)) {
	// 				library.config.loading.snapshot = (round > 1) ? (round - 1) : 1;
	// 			}
	// 		}
	//
	// 		library.logger.info('Snapshotting to end of round: ' + library.config.loading.snapshot);
	// 	}
	//
	// 	if (count === 1) {
	// 		return reload(count);
	// 	}
	//
	// 	if (verify) {
	// 		return reload(count, 'Blocks verification enabled');
	// 	}
	//
	// 	if (missed) {
	// 		return reload(count, 'Detected missed blocks in mem_accounts');
	// 	}
	//
	// 	var unapplied = results[2].filter(function (row) {
	// 		return (row.round !== String(round));
	// 	});
	//
	// 	if (unapplied.length > 0) {
	//
	// 		return reload(count, 'Detected unapplied rounds in mem_round');
	// 	}
	//
	// 	function updateMemAccounts (t) {
	// 		var promises = [
	// 			t.none(sql.updateMemAccounts),
	// 			t.query(sql.getOrphanedMemAccounts),
	// 			t.query(sql.getDelegates)
	// 		];
	//
	// 		return t.batch(promises);
	// 	}
	//
	// 	library.db.task(updateMemAccounts).then(function (results) {
	// 		if (results[1].length > 0) {
	// 			return reload(count, 'Detected orphaned blocks in mem_accounts');
	// 		}
	//
	// 		if (results[2].length === 0) {
	// 			return reload(count, 'No delegates found');
	// 		}
	//
	// 		modules.blocks.loadLastBlock(function (err, block) {
	// 			if (err) {
	// 				return reload(count, err || 'Failed to load last block');
	// 			} else {
	// 				__private.lastBlock = block;
	// 				library.bus.message('databaseLoaded', block);
	// 			}
	// 		});
	// 	});
	// }).catch(function (err) {
	// 	library.logger.error("error:",err);
	// 	return process.exit(0);
	// });
};

__private.shuffle = function(array) {
	var currentIndex = array.length, temporaryValue, randomIndex;

	// While there remain elements to shuffle...
	while (0 !== currentIndex) {

		// Pick a remaining element...
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex -= 1;

		// And swap it with the current element.
		temporaryValue = array[currentIndex];
		array[currentIndex] = array[randomIndex];
		array[randomIndex] = temporaryValue;
	}

	return array;
}

__private.loadBlocksFromNetwork = function (cb) {
	var tryCount = 0;
	//var loaded = false;

	var network = __private.network;

	var peers=__private.shuffle(network.peers).sort(function(p1, p2){
		if(p1.height==p2.height){
			return p1.blockheader.timestamp - p2.blockheader.timestamp;
		}
		else{
			return p1.height<p2.height;
		}
	});



	//TODO: tryCount is accounting for 2 use cases :
	// - no more blocks downloaded
	// - error finding common blocks
	// should be separated because the strategies are different.
	async.whilst(
		function () {
			return modules.blockchain.isMissingNewBlock() && (tryCount < 3) && (peers.length > tryCount);
		},
		function (next) {

			var peer = peers[tryCount];
			var lastBlock = modules.blockchain.getLastBlock();

			async.waterfall([
				function getCommonBlock (seriesCb) {
					return seriesCb();
					// if (lastBlock.height === 1){
					// 	return seriesCb();
					// }
					// __private.blocksToSync = peer.height - lastBlock.height;
					// library.logger.debug('Looking for common block with: ' + peer.toString());
					// modules.blocks.getCommonBlock(peer, lastBlock.height, function (err, result) {
					// 	if (err) {
					// 		tryCount++;
					// 		library.logger.error(err, result);
					// 		return seriesCb(err);
					// 	}
					// 	else if (result.lastBlockHeight && result.lastBlockHeight <= lastBlock.height){
					// 		tryCount++;
					// 		return seriesCb("No new block from " + peer.toString());
					// 	}
					// 	else if (!result.common) {
					// 		tryCount++;
					// 		return seriesCb("Detected forked chain, no common block with " + peer.toString());
					// 	}
					// 	else{
					// 		library.logger.info(['Found common block ', result.common.height, 'with', peer.toString()].join(' '));
					// 		return seriesCb();
					// 	}
					// });
				},
				function loadBlocks (seriesCb) {
					modules.blocks.loadBlocksFromPeer(peer, seriesCb);
				}
			], function (err, block) {
				// no new block processed
				if(!block || block.height == lastBlock.height + 1){
					tryCount++;
					library.logger.info("No new block processed from " + peer.toString());
				}
				else{
					if(err){
						tryCount++;
						library.logger.error(err);
					}
					library.logger.info("Processsed blocks to height " + block.height + " from " + peer.toString());
				}


				next();
			});
		},
		function (err) {
			if (err) {
				library.logger.error('Failed to load blocks from network', err);
				return cb(err);
			} else {
				return cb(null, __private.lastBlock);
			}
		}
	);

	// async.whilst(
	// 	function () {
	// 		return !loaded && (errorCount < 5) && (peers.length > errorCount+1);
	// 	},
	// 	function (next) {
	// 		var peer = peers[errorCount];
	// 		var lastBlock = modules.blocks.getLastBlock();
	//
	// 		function loadBlocks (cb) {
	// 			__private.blocksToSync = peer.height - lastBlock.height;
	// 			modules.blocks.loadBlocksFromPeer(peer, function (err, lastValidBlock) {
	// 				if (err) {
	// 					library.logger.error(err.toString());
	// 					errorCount += 1;
	// 					return cb('Unable to load blocks from ' + peer.string);
	// 				}
	// 				loaded = (lastValidBlock.height == modules.blocks.getLastBlock().height) || (lastValidBlock.id == __private.lastBlock.id);
	// 				__private.lastBlock = lastValidBlock;
	// 				lastValidBlock = null;
	// 				return cb();
	// 			});
	// 		}
	// 		// we make sure we are on same chain
	// 		function getCommonBlock (cb) {
	// 			// get last version of peer header
	// 			__private.blocksToSync = peer.height - lastBlock.height;
	// 			library.logger.info('Looking for common block with: ' + peer.string);
	// 			modules.blocks.getCommonBlock(peer, lastBlock.height, function (err, commonBlock) {
	// 				if (!commonBlock) {
	// 					if (err) {
	// 						library.logger.error(err.toString());
	// 					}
	// 					modules.peers.remove(peer.ip, peer.port);
	// 					return cb("Detected forked chain, no common block with: " + peer.string);
	// 				} else {
	// 					library.logger.info(['Found common block:', commonBlock.id, 'with:', peer.string].join(' '));
	// 					return cb();
	// 				}
	// 			});
	// 		}
	//
	// 		if (lastBlock.height === 1) {
	// 			loadBlocks(next);
	// 	 	} else {
	// 		 	getCommonBlock(function(cb, err){
	// 				if(err){
	// 					next(err);
	// 				}
	// 				else{
	// 					loadBlocks(function(err){
	// 						next(err);
	// 					});
	// 				}
	//
	// 			});
	// 		}
	// 	},
	// 	function (err) {
	// 		if (err) {
	// 			library.logger.error('Failed to load blocks from network', err);
	// 			return cb(err);
	// 		} else {
	// 			return cb();
	// 		}
	// 	}
	// );
};

__private.syncFromNetwork = function (cb) {
	if(self.syncing()){
		library.logger.info('Already syncing');
		return cb();
	}
	library.logger.debug('Starting sync');
	__private.syncFromNetworkTrigger(true);

	async.series({
		undoUnconfirmedList: function (seriesCb) {
			library.logger.debug('Undoing unconfirmed transactions before sync');
			return modules.transactionPool.undoUnconfirmedList([], seriesCb);
		},
		loadBlocksFromNetwork: function (seriesCb) {
			return __private.loadBlocksFromNetwork(seriesCb);
		},
		applyUnconfirmedList: function (seriesCb) {
			library.logger.debug('Applying unconfirmed transactions after sync');
			return modules.transactionPool.applyUnconfirmedList(seriesCb);
		}
	}, function (err) {
		__private.syncFromNetworkTrigger(false);
		__private.blocksToSync = 0;

		library.logger.debug('Finished sync');
		return cb(err);
	});
};

// Given a list of peers with associated blockchain height (heights = {peer: peer, height: height}), we find a list of good peers (likely to sync with), then perform a histogram cut, removing peers far from the most common observed height. This is not as easy as it sounds, since the histogram has likely been made accross several blocks, therefore need to aggregate).
__private.findGoodPeers = function (heights) {
	// Removing unreachable peers
	heights = heights.filter(function (item) {
		return item != null;
	});

	// Ordering the peers with descending height
	heights = heights.sort(function (a,b) {
		return b.height - a.height;
	});

	var histogram = {};
	var max = 0;
	var height;

	// Aggregating height by 2. TODO: To be changed if node latency increases?
	var aggregation = 2;

	// Histogram calculation, together with histogram maximum
	for (var i in heights) {
		var val = parseInt(heights[i].height / aggregation) * aggregation;
		histogram[val] = (histogram[val] ? histogram[val] : 0) + 1;

		if (histogram[val] > max) {
			max = histogram[val];
			height = val;
		}
	}

	// Performing histogram cut of peers too far from histogram maximum
	// TODO: to fine tune
	var peers = heights.filter(function (item) {
		return item && Math.abs(height - item.height) < aggregation + 3;
	}).map(function (item) {
		item.peer.height = item.height;
		item.peer.blockheader = item.header;
		return item.peer;
	});
	return {height: height, peers: peers};
};

// Public methods

//
//__API__ `triggerBlockRemoval`

//
Loader.prototype.triggerBlockRemoval = function(number){
	__private.forceRemoveBlocks = number;
};

//
//__API__ `resetMemAccounts`

//
Loader.prototype.resetMemAccounts = function(cb){
	library.db.none(sql.resetMemAccounts).then(function(){
		return cb();
	}).catch(cb);
};

//
//__API__ `cleanMemAccounts`

//
Loader.prototype.cleanMemAccounts = function(cb){
	library.db.none(sql.cleanMemAccounts).then(function(){
		return cb();
	}).catch(cb);
};

//
//__API__ `rebuildBalance`

//
Loader.prototype.rebuildBalance = function(cb){
	var accounts = {};
	var addressesSQL='select distinct("recipientId") as address from transactions group by "recipientId"'
	var publicKeysSQL='select distinct("senderPublicKey") as publicKey from transactions group by "senderPublicKey"';
	async.series([
		function(seriesCb){
			library.db.query(addressesSQL).then(function(addresses){
				addresses.forEach(function(address){
					accounts[address] = {address: address};
				});
				return seriesCb();
			}).catch(seriesCb);
		},
		function(seriesCb){
			library.db.query(publicKeysSQL).then(function(pks){
				pks.forEach(function(pk){
					accounts[arkjs.crypto.getAddress(address)].publicKey = pk;
				});
				return seriesCb();
			}).catch(seriesCb);
		},
		function(seriesCb){
			for(var address in accounts){
				var account = accounts[address];
				if(account.publicKey){

				}
			}
		}
	],function(error){

	});
};

//
//__API__ `rebuildVotes`

//
Loader.prototype.rebuildVotes = function(cb){
	library.db.none(sql.rebuildVotes).then(function(){
		return cb();
	}).catch(cb);
};


// get the smallest block timestamp at the higjest height from network
//
//__API__ `getNetworkSmallestBlock`

//
Loader.prototype.getNetworkSmallestBlock = function(){
	var bestBlock = null;
	__private.network.peers.forEach(function(peer){
		if(!bestBlock){
			bestBlock=peer.blockheader;
		}
		else if(!modules.system.isMyself(peer)){
			if(peer.blockheader.height>bestBlock.height){
				bestBlock=peer.blockheader;
			}
			else if(peer.blockheader.height == bestBlock.height && peer.blockheader.timestamp < bestBlock.timestamp){
				bestBlock=peer.blockheader;
			}
		}
	});
	return bestBlock;
}

// Rationale:
// - We pick 100 random peers from a random peer (could be unreachable).
// - Then for each of them we grab the height of their blockchain.
// - With this list we try to get a peer with sensibly good blockchain height (see __private.findGoodPeers for actual strategy).
//
//__API__ `getNetwork`

//
Loader.prototype.getNetwork = function (force, cb) {
	// If __private.network.height is not so far (i.e. 1 round) from current node height, just return cached __private.network.
	// If node is forging, do it more often (every block?)
	var distance = modules.delegates.isActiveDelegate() ? 2 : 51;

	if (!force && __private.network.height > 0 && Math.abs(__private.network.height - modules.blocks.getLastBlock().height) < distance) {
		return cb(null, __private.network);
	}

	var peers = modules.peers.listPBFTPeers();

	// Validate each peer and then attempt to get its height
	async.map(peers, function (peer, cb) {
		peer.fetchStatus(function (err, res) {
			if (err) {
				library.logger.warn('Failed to get height from peer', peer.toString());
				library.logger.warn('Error', err);
				return cb();
			}
			else{
				library.logger.debug(['Received height: ', res.body.header.height, ', block_id: ', res.body.header.id,' from peer'].join(''), peer.toString());
				return cb(null, {peer: peer, height: res.body.header.height, header:res.body.header});
			}
		});
	}, function (err, heights) {
		__private.network = __private.findGoodPeers(heights);

		if (err) {
			return cb(err);
		} else if (!__private.network.peers.length) {
			return cb('Failed to find enough good peers to sync with');
		} else {
			return cb(null, __private.network);
		}
	});
};

//
//__API__ `syncing`

//
Loader.prototype.syncing = function () {
	return !!__private.syncFromNetworkIntervalId;
};

// #Events

//
//__EVENT__ `onBind`

//
Loader.prototype.onBind = function (scope) {
	modules = scope;
};

//
//__EVENT__ `onLoadDatabase`

//
Loader.prototype.onLoadDatabase = function(){
	__private.loadBlockChain();
};

//
//__EVENT__ `onObserveNetwork`

//
Loader.prototype.onObserveNetwork = function(){
	self.getNetwork(true, function(err, network){
		library.bus.message("networkObserved", network);
	});
};

//
//__EVENT__ `onAttachPublicApi`

//
Loader.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};

// Blockchain loaded from database and ready to accept blocks from network
//
//__EVENT__ `onDownloadBlocks`

//
Loader.prototype.onDownloadBlocks = function (cb) {

	__private.loadBlocksFromNetwork(cb);
};

// Shutdown asked.
//
//__API__ `cleanup`

//
Loader.prototype.cleanup = function (cb) {
	if (!__private.noShutdownRequired) {
		return cb();
	} else {
		setImmediate(function nextWatch () {
			if (__private.noShutdownRequired) {
				library.logger.info('Waiting for network synchronisation to finish...');
				setTimeout(nextWatch, 1 * 1000);
			} else {
				return cb();
			}
		});
	}
};

// Private
__private.ping = function (cb) {
	var lastBlock = modules.blocks.getLastBlock();

	if (lastBlock && lastBlock.fresh) {
		return cb(200, {success: true});
	} else {
		return cb(503, {success: false});
	}
};

// Shared
shared.status = function (req, cb) {
	return cb(null, {
		loaded: __private.blockchainReady,
		now: __private.lastBlock.height,
		blocksCount: __private.total
	});
};

shared.sync = function (req, cb) {
	return cb(null, {
		syncing: self.syncing(),
		blocks: __private.blocksToSync,
		height: modules.blocks.getLastBlock().height,
		id: modules.blocks.getLastBlock().id
	});
};

shared.autoconfigure = function (req, cb) {
	return cb(null, {
		network: {
	    "nethash": library.config.nethash,
	    "token": library.config.network.client.token,
	    "symbol": library.config.network.client.symbol,
	    "explorer": library.config.network.client.explorer,
	    "version": library.config.network.pubKeyHash
		}
	});
};

// Export
module.exports = Loader;
