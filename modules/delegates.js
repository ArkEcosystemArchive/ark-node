'use strict';

var _ = require('lodash');
var async = require('async');
var bignum = require('../helpers/bignum.js');
var BlockReward = require('../logic/blockReward.js');
var checkIpInList = require('../helpers/checkIpInList.js');
var constants = require('../helpers/constants.js');
var extend = require('extend');
var MilestoneBlocks = require('../helpers/milestoneBlocks.js');
var OrderBy = require('../helpers/orderBy.js');
var Router = require('../helpers/router.js');
var schema = require('../schema/delegates.js');
var slots = require('../helpers/slots.js');
var sql = require('../sql/delegates.js');
var transactionTypes = require('../helpers/transactionTypes.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.assetTypes = {};
// Server is in forging mode, does not mean it has been configured properly.
__private.forging = false;
// Is the node currently forging for an active delegate at the current internal state of blockchain
__private.isActiveDelegate = false;
// Block Reward calculator
__private.blockReward = new BlockReward();
// keypairs used to sign forge blocks, extracted from passphrase in config files
__private.keypairs = {};
// tempo helper to start forging not righ now
__private.coldstart = new Date().getTime();

// Constructor
function Delegates (cb, scope) {
	library = scope;
	self = this;


	var Delegate = require('../logic/delegate.js');
	__private.assetTypes[transactionTypes.DELEGATE] = library.logic.transaction.attachAssetType(
		transactionTypes.DELEGATE, new Delegate()
	);

	return cb(null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.map(shared, {
		'get /count': 'count',
		'get /search': 'search',
		'get /voters': 'getVoters',
		'get /get': 'getDelegate',
		'get /': 'getDelegates',
		'get /fee': 'getFee',
		'get /forging/getForgedByAccount': 'getForgedByAccount',
		'put /': 'addDelegate',
 		'get /getNextForgers': 'getNextForgers'
	});

	if (process.env.DEBUG) {
		var tmpKepairs = {};

		router.get('/forging/disableAll', function (req, res) {
			if (Object.keys(tmpKepairs).length !== 0) {
				return res.json({success: false});
			}

			tmpKepairs = __private.keypairs;
			__private.keypairs = {};
			return res.json({success: true});
		});

		router.get('/forging/enableAll', function (req, res) {
			if (Object.keys(tmpKepairs).length === 0) {
				return res.json({success: false});
			}

			__private.keypairs = tmpKepairs;
			tmpKepairs = {};
			return res.json({success: true});
		});
	}

	router.post('/forging/enable', function (req, res) {
		library.schema.validate(req.body, schema.enableForging, function (err) {
			if (err) {
				return res.json({success: false, error: err[0].message});
			}

			var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

			if (!checkIpInList(library.config.forging.access.whiteList, ip)) {
				return res.json({success: false, error: 'Access denied'});
			}

			var keypair = library.crypto.makeKeypair(crypto.createHash('sha256').update(req.body.secret, 'utf8').digest());

			if (req.body.publicKey) {
				if (keypair.publicKey.toString('hex') !== req.body.publicKey) {
					return res.json({success: false, error: 'Invalid passphrase'});
				}
			}

			if (__private.keypairs[keypair.publicKey.toString('hex')]) {
				return res.json({success: false, error: 'Forging is already enabled'});
			}

			modules.accounts.getAccount({publicKey: keypair.publicKey.toString('hex')}, function (err, account) {
				if (err) {
					return res.json({success: false, error: err});
				}
				if (account && account.isDelegate) {
					__private.keypairs[keypair.publicKey.toString('hex')] = keypair;
					library.logger.info('Forging enabled on account: ' + account.address);
					return res.json({success: true, address: account.address});
				} else {
					return res.json({success: false, error: 'Delegate not found'});
				}
			});
		});
	});

	router.post('/forging/disable', function (req, res) {
		library.schema.validate(req.body, schema.disableForging, function (err) {
			if (err) {
				return res.json({success: false, error: err[0].message});
			}

			var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

			if (!checkIpInList(library.config.forging.access.whiteList, ip)) {
				return res.json({success: false, error: 'Access denied'});
			}

			var keypair = library.crypto.makeKeypair(crypto.createHash('sha256').update(req.body.secret, 'utf8').digest());

			if (req.body.publicKey) {
				if (keypair.publicKey.toString('hex') !== req.body.publicKey) {
					return res.json({success: false, error: 'Invalid passphrase'});
				}
			}

			if (!__private.keypairs[keypair.publicKey.toString('hex')]) {
				return res.json({success: false, error: 'Delegate not found'});
			}

			modules.accounts.getAccount({publicKey: keypair.publicKey.toString('hex')}, function (err, account) {
				if (err) {
					return res.json({success: false, error: err});
				}
				if (account && account.isDelegate) {
					delete __private.keypairs[keypair.publicKey.toString('hex')];
					library.logger.info('Forging disabled on account: ' + account.address);
					return res.json({success: true, address: account.address});
				} else {
					return res.json({success: false, error: 'Delegate not found'});
				}
			});
		});
	});

	router.get('/forging/status', function (req, res) {
		library.schema.validate(req.query, schema.forgingStatus, function (err) {
			if (err) {
				return res.json({success: false, error: err[0].message});
			}

			return res.json({success: true, enabled: !!__private.keypairs[req.query.publicKey]});
		});
	});

	// router.map(__private, {
	//   'post /forging/enable': 'enableForging',
	//   'post /forging/disable': 'disableForging',
	//   'get /forging/status': 'statusForging'
	// });

	library.network.app.use('/api/delegates', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};


// TODO: highly buggy
// 1. we are not sure we have the last block height!
// 2. corner case: height last block of the round? we may get the very wrong delegate list
__private.getBlockSlotData = function (slot, height, cb) {
	modules.rounds.getActiveDelegates(function (err, activeDelegates) {
		if (err) {
			return cb(err);
		}

		var currentSlot = slot;
		var lastSlot = slots.getLastSlot(currentSlot);

		for (; currentSlot < lastSlot; currentSlot += 1) {
			var delegate_pos = currentSlot % slots.delegates;
			var delegate_id = activeDelegates[delegate_pos];

			if (delegate_id && __private.keypairs[delegate_id]) {
				return cb(null, {time: slots.getSlotTime(currentSlot), keypair: __private.keypairs[delegate_id]});
			}
		}
		return cb(null, null);
	});
};

__private.forge = function (cb) {
	var err;
	if (!Object.keys(__private.keypairs).length) {
		err = 'No delegates enabled';
		return cb(err);
	}

	if (!__private.forging) {
		err = 'Forging disabled';
		return cb(err);
	}

	var currentSlot = slots.getSlotNumber();
	// If we are supposed to forge now, be sure we got the very last block
	var lastBlock = modules.blockchain.getLastBlock();
	if (!lastBlock || currentSlot === slots.getSlotNumber(lastBlock.timestamp)) {
		err = 'Last block within same delegate slot';
		return cb(err);
	}

	__private.getBlockSlotData(currentSlot, lastBlock.height + 1, function (err, currentBlockData) {
		if (err || currentBlockData === null) {
			err = err || 'Skipping delegate slot';
			return cb(err);
		}


		var coldstart = library.config.forging.coldstart ? library.config.forging.coldstart : 60;
		if ((slots.getSlotNumber(currentBlockData.time) === slots.getSlotNumber()) && (new Date().getTime()-__private.coldstart > coldstart*1000)) {
			modules.transactionPool.fillPool(constants.maxTxsPerBlock, function(err){
				// Using PBFT observation: if a good quorum is at the same height with same blockid -> let's forge
				// TODO: we should pre ask network quorum if i can send this forged block, sending node publicKey, a timestamp and a signature of the timestamp.
				// This is to prevent from delegate multiple forging on several servers.
				modules.loader.getNetwork(true, function (err, network) {
					var minimumNetworkReach=library.config.peers.minimumNetworkReach;
					if(!minimumNetworkReach){
						minimumNetworkReach = 20;
					}

					if (err) {
						return cb(err);
					}
					else if(network.peers.length < minimumNetworkReach){
						library.logger.info("Network reach is not sufficient to get quorum",[
							"network # of reached peers:", network.peers.length,
							"last block id:", lastBlock.id
						].join(' '));
						return cb();
					}
					else {
						var quorum = 0;
						var noquorum = 0;
						var maxheight = lastBlock.height;
						var overheightquorum = 0;
						var overheightblock = null;
						var letsforge = false;
						for(var i in network.peers){
							var peer = network.peers[i];
							if(peer.height == lastBlock.height){
								if(peer.blockheader.id == lastBlock.id && peer.currentSlot == currentSlot && peer.forgingAllowed){
									quorum = quorum + 1;
								}
								else{
									noquorum = noquorum + 1;
								}
							}
							// I don't have the last block out there ?
							else if(peer.height > lastBlock.height){
								maxheight = peer.height;
								noquorum = noquorum + 1;
								// overheightquorum = overheightquorum + 1;
								// overheightblock = peer.blockheader;
							}
							// suppose the max network elasticity accross 3 blocks
							else if(lastBlock.height - peer.height < 3){
								noquorum = noquorum + 1;
							}
						}

						//if a node has a height > lastBlock.height, let's wait before forging.
						if(overheightquorum > 0){
							//TODO: we should check if the "over height" block is legit:
							// # if delegate = myself -> legit -> letsforge = false (multiple node forging same delegate)
							if(overheightblock.generatorPublicKey == currentBlockData.keypair.publicKey){
								return cb();
							}
							// # if delegate != myself and blockslot = my slot -> attack or forked from them.

							// # if blockslot < my slot -> legit (otherwise uncle forging) -> letsforge = false

							// # if blockslot > my slot
							//   -> if delegate is legit for the blockslot -> too late -> letsforge = false (otherwise the node will fork 1)
							//   -> if delegate is not legit -> attack -> letsforge = true

							return cb();
						}
						// PBFT: most nodes are on same branch, no other block have been forged and we are on forgeable currentSlot
						if(quorum/(quorum+noquorum) > 0.66){
							letsforge = true;
						}
						else{
							//We are forked!
							library.logger.info("Forked from network",[
								"network:", JSON.stringify(network.height),
								"quorum:", quorum/(quorum+noquorum),
								"last block id:", lastBlock.id
							].join(' '));
							library.bus.message("fork",lastBlock, 6);
							return cb("Fork 6 - Not enough quorum to forge next block: " + quorum/(quorum+noquorum));
						}

						if(letsforge){
							library.logger.info("Enough quorum from network",[
								"quorum:", quorum/(quorum+noquorum),
								"last block id:", lastBlock.id
							].join(' '));
							modules.blocks.generateBlock(currentBlockData.keypair, currentBlockData.time, function (err, b) {
								if(!err){
									library.logger.info([
										'Forged new block id:', b.id,
										'height:', b.height,
										'round:', modules.rounds.getRoundFromHeight(b.height),
										'slot:', slots.getSlotNumber(currentBlockData.time),
										'reward:' + b.reward,
										'transactions:' + b.numberOfTransactions
									].join(' '));
									library.bus.message('blockForged', b, cb);
								}
								else{
									library.logger.error('Failed generate block within delegate slot', err);
									return cb(err);
								}
							});
						}
					}
				});
			});
		} else {
			library.logger.debug('Delegate slot', slots.getSlotNumber());
			return cb();
		}
	});
};

__private.checkDelegates = function (publicKey, votes, state, cb) {
	if (!Array.isArray(votes)) {
		return cb('Votes must be an array');
	}

	modules.accounts.getAccount({publicKey: publicKey}, function (err, account) {
		if (err) {
			return cb(err);
		}

		if (!account) {
			return cb('Account not found');
		}

		var delegates = (state === 'confirmed') ? account.delegates : account.u_delegates;
		var existing_votes = Array.isArray(delegates) ? delegates.length : 0;
		var additions = 0, removals = 0;

		async.eachSeries(votes, function (action, eachSeriesCb) {
			var math = action[0];

			if (math !== '+' && math !== '-') {
				return eachSeriesCb('Invalid math operator');
			}

			if (math === '+') {
				additions += 1;
			} else if (math === '-') {
				removals += 1;
			}

			var publicKey = action.slice(1);

			try {
				new Buffer(publicKey, 'hex');
			} catch (e) {
				library.logger.error("stack", e.stack);
				return eachSeriesCb('Invalid public key');
			}

			if (math === '+' && (delegates != null && delegates.indexOf(publicKey) !== -1)) {
				return eachSeriesCb('Failed to add vote, account has already voted for this delegate');
			}

			if (math === '-' && (delegates === null || delegates.indexOf(publicKey) === -1)) {
				return eachSeriesCb('Failed to remove vote, account has not voted for this delegate');
			}

			modules.accounts.getAccount({ publicKey: publicKey, isDelegate: 1 }, function (err, account) {
				if (err) {
					return eachSeriesCb(err);
				}

				if (!account) {
					return eachSeriesCb('Delegate not found');
				}

				return eachSeriesCb();
			});
		}, function (err) {
			if (err) {
				return cb(err);
			}

			var total_votes = (existing_votes + additions) - removals;

			if (total_votes > constants.maximumVotes) {
				var exceeded = total_votes - constants.maximumVotes;

				return cb('Maximum number of ' + constants.maximumVotes + ' votes exceeded (' + exceeded + ' too many)');
			} else {
				return cb();
			}
		});
	});
};

__private.loadMyDelegates = function (cb) {
	var secrets = [];
	if (library.config.forging.secret) {
		secrets = Array.isArray(library.config.forging.secret) ? library.config.forging.secret : [library.config.forging.secret];
	}

	async.eachSeries(secrets, function (secret, seriesCb) {
		var keypair = library.crypto.makeKeypair(secret);

		// already loaded? Do nothing
		if(__private.keypairs[keypair.publicKey.toString('hex')]){
			return seriesCb();
		}

		modules.accounts.getAccount({
			publicKey: new Buffer(keypair.publicKey, "hex")
		}, function (err, account) {
			if (err) {
				return seriesCb(err);
			}

			if (!account) {
				return seriesCb('Account ' + keypair.publicKey.toString('hex') + ' not found');
			}

			if (account.isDelegate) {
				__private.keypairs[keypair.publicKey.toString('hex')] = keypair;
				library.logger.info('Forging enabled on account: ' + account.address);
			} else {
				library.logger.warn('Delegate with this public key not found: ' + keypair.publicKey.toString('hex'));
			}
			return seriesCb();
		});
	}, function(err){
		return cb(err, __private.keypairs);
	});
};


// Public methods
//
//__API__ `isAForgingDelegatesPublicKey`

//
Delegates.prototype.isAForgingDelegatesPublicKey = function(publicKey) {
	//don't leak privateKey out of the module!
	return !!__private.keypairs[publicKey];
}


//
//__API__ `getDelegates`

//
Delegates.prototype.getDelegates = function (query, cb) {
	if (!query) {
		throw 'Missing query argument';
	}
	modules.accounts.getAccounts({
		isDelegate: 1,
		sort: { 'vote': -1, 'publicKey': 1 }
	}, ['username', 'address', 'publicKey', 'vote', 'missedblocks', 'producedblocks'], function (err, delegates) {
		if (err) {
			return cb(err);
		}

		var limit = query.limit || constants.activeDelegates;
		var offset = query.offset || 0;
		var active = query.active;

		limit = limit > constants.activeDelegates ? constants.activeDelegates : limit;

		var count = delegates.length;
		var length = Math.min(limit, count);
		var realLimit = Math.min(offset + limit, count);

		var lastBlock   = modules.blockchain.getLastBlock(),
		    totalSupply = __private.blockReward.calcSupply(lastBlock.height);

		for (var i = 0; i < delegates.length; i++) {
			delegates[i].rate = i + 1;
			delegates[i].approval = (delegates[i].vote / totalSupply) * 100;
			delegates[i].approval = Math.round(delegates[i].approval * 1e2) / 1e2;

			var percent = 100 - (delegates[i].missedblocks / ((delegates[i].producedblocks + delegates[i].missedblocks) / 100));
			percent = Math.abs(percent) || 0;

			var outsider = i + 1 > slots.delegates;
			delegates[i].productivity = (!outsider) ? Math.round(percent * 1e2) / 1e2 : 0;
		}

		var orderBy = OrderBy(query.orderBy, {quoteField: false});

		if (orderBy.error) {
			return cb(orderBy.error);
		}

		return cb(null, {
			delegates: delegates,
			sortField: orderBy.sortField,
			sortMethod: orderBy.sortMethod,
			count: count,
			offset: offset,
			limit: realLimit
		});
	});
};

//
//__API__ `checkConfirmedDelegates`

//
Delegates.prototype.checkConfirmedDelegates = function (publicKey, votes, cb) {
	return __private.checkDelegates(publicKey, votes, 'confirmed', cb);
};

//
//__API__ `checkUnconfirmedDelegates`

//
Delegates.prototype.checkUnconfirmedDelegates = function (publicKey, votes, cb) {
	return __private.checkDelegates(publicKey, votes, 'unconfirmed', cb);
};

//
//__API__ `validateBlockSlot`

//
Delegates.prototype.validateBlockSlot = function (block, cb) {
	var round = modules.rounds.getRoundFromHeight(block.height);

	modules.rounds.getActiveDelegatesFromRound(round, function (err, activeDelegates) {
		if (err) {
			return cb(err);
		}

		var currentSlot = slots.getSlotNumber(block.timestamp);
		var delegate_id = activeDelegates[currentSlot % slots.delegates];

		if (delegate_id && block.generatorPublicKey === delegate_id) {
			return cb(null, block);
		} else {
			library.logger.error('Expected generator: ' + delegate_id + ' Received generator: ' + block.generatorPublicKey);
			return cb('Failed to verify slot: ' + currentSlot);
		}
	});
};

// Events
//
//__EVENT__ `onBind`

//
Delegates.prototype.onBind = function (scope) {
	modules = scope;

	__private.assetTypes[transactionTypes.DELEGATE].bind({
		modules: modules, library: library
	});
};


//
//__EVENT__ `onLoadDelegates`

//
Delegates.prototype.onLoadDelegates = function () {
	__private.loadMyDelegates(function(err, keypairs){
		if(err){
			library.logger.error(err);
		}
		library.bus.message('delegatesLoaded', keypairs);
	});
};

//
//__EVENT__ `onStartForging`

//
Delegates.prototype.onStartForging = function () {
	__private.forging = true;
	function forgeLoop(){
		__private.forge(function(debug){
			if(debug && Math.random()<1){
				library.logger.debug(debug);
			}
			if(__private.forging){
				return setTimeout(forgeLoop, 1000);
			}
		});
	};
	forgeLoop();
};

//
//__EVENT__ `onStopForging`

//
Delegates.prototype.onStopForging = function () {
	__private.forging = false;
};

//
//__EVENT__ `onAttachPublicApi`

//
Delegates.prototype.onAttachPublicApi = function () {
	__private.attachApi();
};


//
//__API__ `cleanup`

//
Delegates.prototype.cleanup = function (cb) {
	return cb();
};

// Ready to forge when it is its slot
//
//__API__ `isForging`

//
Delegates.prototype.isForging = function(){
	return __private.forging;
}

// Is node active at current height of internal blockchain
//
//__API__ `isActiveDelegate`

//
Delegates.prototype.isActiveDelegate = function(){
	return __private.isActiveDelegate;
}

//
//__API__ `updateActiveDelegate`

//
Delegates.prototype.updateActiveDelegate = function(activeDelegates){
	var registeredDelegatesPublicKeys = Object.keys(__private.keypairs);
	var isActive = false;

	for(var i in activeDelegates){
		isActive |= registeredDelegatesPublicKeys.indexOf(activeDelegates[i].publicKey) > -1;
	}

	if(!__private.isActiveDelegate && isActive){
		library.logger.info('# Congratulations! This node is now an active delegate');
	}
	else if(__private.isActiveDelegate && !isActive){
		library.logger.info('# Oh snap! This node is not active delegate anymore');
	}

	__private.isActiveDelegate = isActive;
}

//
//__API__ `enableForging`

//
Delegates.prototype.enableForging = function () {
	if (!__private.forging) {
		library.logger.debug('Enabling forging');
		__private.forging = true;
	}

	return __private.forging;
};

//
//__API__ `disableForging`

//
Delegates.prototype.disableForging = function (reason) {
	if (__private.forging) {
		library.logger.debug('Disabling forging due to:', reason);
		__private.forging = false;
	}

	return __private.forging;
};

// Private
__private.toggleForgingOnReceipt = function () {
	var lastReceipt = modules.blocks.lastReceipt();

	// Enforce local forging if configured
	if (!lastReceipt && library.config.forging.force) {
		lastReceipt = modules.blocks.lastReceipt(new Date());
	}

	if (lastReceipt) {
		var timeOut = Number(constants.forgingTimeOut);



		// if (lastReceipt.secondsAgo > timeOut) {
		// 	return self.disableForging('timeout');
		// } else {
		return self.enableForging();
		// }
	}
};

// Shared
shared.getDelegate = function (req, cb) {
	library.schema.validate(req.body, schema.getDelegate, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		modules.delegates.getDelegates(req.body, function (err, data) {
			if (err) {
				return cb(err);
			}

			var delegate = _.find(data.delegates, function (delegate) {
				if (req.body.publicKey) {
					return delegate.publicKey === req.body.publicKey;
				} else if (req.body.username) {
					return delegate.username === req.body.username;
				}

				return false;
			});

			if (delegate) {
				return cb(null, {delegate: delegate});
			} else {
				return cb('Delegate not found');
			}
		});
	});
};

shared.getNextForgers = function (req, cb) {
	var currentBlock = modules.blockchain.getLastBlock();
	var limit = req.body.limit || 10;

	modules.rounds.getActiveDelegates(function (err, activeDelegates) {
		if (err) {
			return cb(err);
		}

		var currentSlot = slots.getSlotNumber(currentBlock.timestamp);
		var nextForgers = [];

		for (var i = 1; i <= slots.delegates && i <= limit; i++) {
			if (activeDelegates[(currentSlot + i) % slots.delegates]) {
				nextForgers.push (activeDelegates[(currentSlot + i) % slots.delegates]);
			}
		}
		return cb(null, {currentBlock: currentBlock.height, currentSlot: currentSlot, delegates: nextForgers});
	});
};

shared.search = function (req, cb) {
	library.schema.validate(req.body, schema.search, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var orderBy = OrderBy(
			req.body.orderBy, {
				sortFields: sql.sortFields,
				sortField: 'username'
			}
		);

		if (orderBy.error) {
			return cb(orderBy.error);
		}

		library.db.query(sql.search({
			q: req.body.q,
			limit: req.body.limit || 100,
			sortField: orderBy.sortField,
			sortMethod: orderBy.sortMethod
		})).then(function (rows) {
			return cb(null, {delegates: rows});
		}).catch(function (err) {
			library.logger.error("stack", err.stack);
			return cb('Database search failed');
		});
	});
};

shared.count = function (req, cb) {
	library.db.one(sql.count).then(function (row) {
		return cb(null, { count: row.count });
	}).catch(function (err) {
		library.logger.error("stack", err.stack);
		return cb('Failed to count delegates');
	});
};

shared.getVoters = function (req, cb) {
	library.schema.validate(req.body, schema.getVoters, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		library.db.one(sql.getVoters, { publicKey: req.body.publicKey }).then(function (row) {
			var addresses = (row.accountIds) ? row.accountIds : [];

			modules.accounts.getAccounts({
				address: { $in: addresses },
				sort: 'balance'
			}, ['address', 'balance', 'username', 'publicKey'], function (err, rows) {
				if (err) {
					return cb(err);
				}

				return cb(null, {accounts: rows});
			});
		}).catch(function (err) {
			library.logger.error("stack", err.stack);
			return cb('Failed to get voters for delegate: ' + req.body.publicKey);
		});
	});
};

shared.getDelegates = function (req, cb) {
	library.schema.validate(req.body, schema.getDelegates, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		modules.delegates.getDelegates(req.body, function (err, data) {
			if (err) {
				return cb(err);
			}

			function compareNumber (a, b) {
				var sorta = parseFloat(a[data.sortField]);
				var sortb = parseFloat(b[data.sortField]);
				if (data.sortMethod === 'ASC') {
					return sorta - sortb;
				} else {
				 	return sortb - sorta;
				}
			}

			function compareString (a, b) {
				var sorta = a[data.sortField];
				var sortb = b[data.sortField];
				if (data.sortMethod === 'ASC') {
				  return sorta.localeCompare(sortb);
				} else {
				  return sortb.localeCompare(sorta);
				}
			}

			if (data.sortField) {
				if (['approval', 'productivity', 'rate', 'vote'].indexOf(data.sortField) > -1) {
					data.delegates = data.delegates.sort(compareNumber);
				} else if (['username', 'address', 'publicKey'].indexOf(data.sortField) > -1) {
					data.delegates = data.delegates.sort(compareString);
				} else {
					return cb('Invalid sort field');
				}
			}

			var delegates = data.delegates.slice(data.offset, data.limit);

			return cb(null, {delegates: delegates, totalCount: data.count});
		});
	});
};

shared.getFee = function (req, cb) {
	return cb(null, {fee: constants.fees.delegate});
};

shared.getForgedByAccount = function (req, cb) {
	library.schema.validate(req.body, schema.getForgedByAccount, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		modules.accounts.getAccount({publicKey: req.body.generatorPublicKey}, ['fees', 'rewards'], function (err, account) {
			if (err || !account) {
				return cb(err || 'Account not found');
			}
			var forged = bignum(account.fees).plus(bignum(account.rewards)).toString();
			return cb(null, {fees: account.fees, rewards: account.rewards, forged: forged});
		});
	});
};

shared.addDelegate = function (req, cb) {
	library.schema.validate(req.body, schema.addDelegate, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var keypair = library.crypto.makeKeypair(req.body.secret);

		if (req.body.publicKey) {
			if (keypair.publicKey.toString('hex') !== req.body.publicKey) {
				return cb('Invalid passphrase');
			}
		}

		library.balancesSequence.add(function (cb) {
			if (req.body.multisigAccountPublicKey && req.body.multisigAccountPublicKey !== keypair.publicKey.toString('hex')) {
				modules.accounts.getAccount({publicKey: req.body.multisigAccountPublicKey}, function (err, account) {
					if (err) {
						return cb(err);
					}

					if (!account || !account.publicKey) {
						return cb('Multisignature account not found');
					}

					if (!account.multisignatures || !account.multisignatures) {
						return cb('Account does not have multisignatures enabled');
					}

					if (account.multisignatures.indexOf(keypair.publicKey.toString('hex')) < 0) {
						return cb('Account does not belong to multisignature group');
					}

					modules.accounts.getAccount({publicKey: keypair.publicKey}, function (err, requester) {
						if (err) {
							return cb(err);
						}

						if (!requester || !requester.publicKey) {
							return cb('Requester not found');
						}

						if (requester.secondSignature && !req.body.secondSecret) {
							return cb('Missing requester second passphrase');
						}

						if (requester.publicKey === account.publicKey) {
							return cb('Invalid requester public key');
						}

						var secondKeypair = null;

						if (requester.secondSignature) {
							secondKeypair = library.crypto.makeKeypair(req.body.secondSecret);
						}

						var transaction;

						try {
							transaction = library.logic.transaction.create({
								type: transactionTypes.DELEGATE,
								username: req.body.username,
								sender: account,
								keypair: keypair,
								secondKeypair: secondKeypair,
								requester: keypair
							});
						} catch (e) {
							return cb(e.toString());
						}

						library.bus.message("transactionsReceived", [transaction], "api", cb);
					});
				});
			} else {
				modules.accounts.setAccountAndGet({publicKey: keypair.publicKey.toString('hex')}, function (err, account) {
					if (err) {
						return cb(err);
					}

					if (!account || !account.publicKey) {
						return cb('Account not found');
					}

					if (account.secondSignature && !req.body.secondSecret) {
						return cb('Invalid second passphrase');
					}

					var secondKeypair = null;

					if (account.secondSignature) {
						secondKeypair = library.crypto.makeKeypair(req.body.secondSecret);
					}

					var transaction;

					try {
						transaction = library.logic.transaction.create({
							type: transactionTypes.DELEGATE,
							username: req.body.username,
							sender: account,
							keypair: keypair,
							secondKeypair: secondKeypair
						});
					} catch (e) {
						return cb(e.toString());
					}

					library.bus.message("transactionsReceived", [transaction], "api", cb);
				});
			}
		}, function (err, transaction) {
			if (err) {
				return cb(err);
			}

			return cb(null, {transaction: transaction[0]});
		});
	});
};

// Export
module.exports = Delegates;
