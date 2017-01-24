'use strict';

var _ = require('lodash');
var async = require('async');
var bignum = require('../helpers/bignum.js');
var crypto = require('crypto');
var extend = require('extend');
var ip = require('ip');
var popsicle = require('popsicle');
var Router = require('../helpers/router.js');
var schema = require('../schema/transport.js');
var sql = require('../sql/transport.js');
var zlib = require('zlib');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.headers = {};
__private.loaded = false;
__private.messages = {};
__private.broadcastTransactions = [];

// Constructor
function Transport (cb, scope) {
	library = scope;
	self = this;

	__private.attachApi();

	setInterval(function(){
		if(__private.broadcastTransactions.length>0){
			var transactions=__private.broadcastTransactions;
			__private.broadcastTransactions=[];
			self.broadcast({limit: 10}, {api: '/transactions', data: {transactions: transactions}, method: 'POST'});
		}
	}, 2*1000);

	setImmediate(cb, null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules && __private.loaded) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.use(function (req, res, next) {
		try {
			req.peer = modules.peers.inspect(
				{
					ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
					port: req.headers.port
				}
			);
		} catch (e) {
			// Remove peer
			__private.removePeer({peer: req.peer, code: 'EHEADERS', req: req});

			library.logger.debug(e.toString());
			return res.status(406).send({success: false, error: 'Invalid request headers'});
		}

		var headers      = req.headers;
		    headers.ip   = req.peer.ip;
		    headers.port = req.peer.port;

		req.sanitize(headers, schema.headers, function (err, report) {
			if (err) { return next(err); }
			if (!report.isValid) {
				// Remove peer
				__private.removePeer({peer: req.peer, code: 'EHEADERS', req: req});

				return res.status(500).send({status: false, error: report.issues});
			}

			if (headers.nethash !== library.config.nethash) {
				// Remove peer
				__private.removePeer({peer: req.peer, code: 'ENETHASH', req: req});

				return res.status(200).send({success: false, message: 'Request is made on the wrong network', expected: library.config.nethash, received: headers.nethash});
			}

			req.peer.state = 2;
			req.peer.os = headers.os;
			req.peer.version = headers.version;

			if ((req.peer.version === library.config.version) && (headers.nethash === library.config.nethash)) {
				if (!modules.blocks.lastReceipt()) {
					modules.delegates.enableForging();
				}
			}

			return next();
		});

	});

	router.get('/list', function (req, res) {
		res.set(__private.headers);
		modules.peers.list({limit: 100}, function (err, peers) {
			return res.status(200).json({peers: !err ? peers : []});
		});
	});

	router.get('/blocks/common', function (req, res, next) {
		res.set(__private.headers);

		req.sanitize(req.query, schema.commonBlock, function (err, report, query) {
			if (err) { return next(err); }
			if (!report.isValid) { return res.json({success: false, error: report.issues}); }

			var escapedIds = query.ids
				// Remove quotes
				.replace(/['"]+/g, '')
				// Separate by comma into an array
				.split(',')
				// Reject any non-numeric values
				.filter(function (id) {
					return /^[0-9]+$/.test(id);
				});

			if (!escapedIds.length) {
				library.logger.warn('Invalid common block request, ban 60 min', req.peer.string);

				return res.json({success: false, error: 'Invalid block id sequence'});
			}

			library.db.query(sql.getCommonBlock, escapedIds).then(function (rows) {
				return res.json({ success: true, common: rows[0] || null });
			}).catch(function (err) {
				library.logger.error(err.stack);
				return res.json({success: false, error: 'Failed to get common block'});
			});
		});
	});

	router.get('/blocks', function (req, res, next) {
		res.set(__private.headers);

		req.sanitize(req.query, schema.blocks, function (err, report, query) {
			if (err) { return next(err); }
			if (!report.isValid) { return res.json({success: false, error: report.issues}); }

			// Get 1400+ blocks with all data (joins) from provided block id
			var limit=1400;

			//if forging send a small bunch only to prevent from being overloaded.
			if(modules.delegates.isActiveDelegate()){
				limit=100;
			}

			library.db.query(sql.blockList, {
				lastBlockHeight: query.lastBlockHeight,
				limit: limit
			}).then(function (rows) {
				res.status(200);
				//library.logger.debug("data", rows);
				res.json({blocks: rows});
			}).catch(function (err) {
				library.logger.error("Error getting blocks from DB", err);
				return res.json({blocks: []});
			});
		});
	});

	router.get('/block', function (req, res, next) {
		res.set(__private.headers);

		req.sanitize(req.query, schema.block, function (err, report, query) {
			if (err) { return next(err); }
			if (!report.isValid) { return res.json({success: false, error: report.issues}); }

			library.db.query(sql.block, {
				id: query.id
			}).then(function (rows) {
				res.status(200);
				//library.logger.debug("data", rows);
				res.json(rows[0]);
			}).catch(function (err) {
				library.logger.error("Error getting block from DB", err);
				return res.json({});
			});
		});
	});

	router.post('/blocks', function (req, res) {
		res.set(__private.headers);

		var block = req.body.block;
		var id = (block ? block.id : 'null');

		try {
			block = library.logic.block.objectNormalize(block);
		} catch (e) {
			library.logger.error(['Block', id].join(' '), e.toString());
			if (block) { library.logger.error('Block', block); }

			if (req.peer) {
				// Ban peer for 60 minutes
				__private.banPeer({peer: req.peer, code: 'EBLOCK', req: req, clock: 3600});
			}

			return res.status(200).json({success: false, error: e.toString()});
		}

		modules.peers.update(req.peer, function(){});

		library.bus.message('receiveBlock', block, req.peer);

		return res.status(200).json({success: true, blockId: block.id});
	});

	// router.post('/signatures', function (req, res) {
	// 	res.set(__private.headers);
	//
	// 	library.schema.validate(req.body, schema.signatures, function (err) {
	// 		if (err) {
	// 			return res.status(200).json({success: false, error: 'Signature validation failed'});
	// 		}
	//
	// 		modules.multisignatures.processSignature(req.body.signature, function (err) {
	// 			if (err) {
	// 				return res.status(200).json({success: false, error: 'Error processing signature'});
	// 			} else {
	// 				return res.status(200).json({success: true});
	// 			}
	// 		});
	// 	});
	// });
	//
	// router.get('/signatures', function (req, res) {
	// 	res.set(__private.headers);
	//
	// 	var unconfirmedList = modules.transactions.getUnconfirmedTransactionList();
	// 	var signatures = [];
	//
	// 	async.eachSeries(unconfirmedList, function (trs, cb) {
	// 		if (trs.signatures && trs.signatures.length) {
	// 			signatures.push({
	// 				transaction: trs.id,
	// 				signatures: trs.signatures
	// 			});
	// 		}
	//
	// 		return setImmediate(cb);
	// 	}, function () {
	// 		return res.status(200).json({success: true, signatures: signatures});
	// 	});
	// });

	router.get('/transactions', function (req, res) {
		res.set(__private.headers);
		res.status(200).json({success: true, transactions: modules.transactions.getUnconfirmedTransactionList()});
	});



	router.post('/transactions', function (req, res) {
		res.set(__private.headers);


		var transactions = req.body.transactions;
		var skimmedtransactions = [];
		var peer=req.peer;

		async.eachSeries(transactions, function (transaction, cb) {
			var id = transaction.id;
			try {
				transaction = library.logic.transaction.objectNormalize(transaction);
			} catch (e) {
				library.logger.error(['Transaction', id].join(' '), e.toString());
				if (transaction) { library.logger.error('Transaction', transaction); }

				library.logger.warn(['Transaction', id, 'is not valid, ban 60 min'].join(' '), peer.string);
				modules.peers.state(peer.ip, peer.port, 0, 3600);

				return setImmediate(cb, e);
			}

			library.db.query(sql.getTransactionId, { id: transaction.id }).then(function (rows) {
				if (rows.length > 0) {
					library.logger.debug('Transaction ID is already in blockchain', transaction.id);
				}
				else{
					skimmedtransactions.push(transaction);
				}
				return setImmediate(cb);
			});
		}, function (err) {
			if(err){
				return res.status(200).json({success: false, message: 'Invalid transaction body detected', error: err.toString()});
			}
			if(skimmedtransactions.length>0){
				library.balancesSequence.add(function (cb) {
					library.logger.debug('Loading '+skimmedtransactions.length+' new transactions from peer '+peer.ip+':'+peer.port);
					modules.transactions.receiveTransactions(skimmedtransactions, cb);
				}, function (err) {
					if (err) {
						res.status(200).json({success: false, message: err.toString()});
					} else {
						modules.peers.update(req.peer, function(){});
						res.status(200).json({success: true, transactionIds: skimmedtransactions.map(function(t){return t.id;})});
					}
				});
			}
			else{
				return res.status(200).json({success: false, message: 'Transactions already in blockchain'});
			}
		});
	});

	router.get('/height', function (req, res) {
		res.set(__private.headers);
		var block = modules.blocks.getLastBlock();
		var blockheader={
			id: block.id,
			height: block.height,
			version: block.version,
			totalAmount: block.totalAmount,
			totalFee: block.totalFee,
			reward: block.reward,
			payloadHash: block.payloadHash,
			timestamp: block.timestamp,
			numberOfTransactions: block.numberOfTransactions,
			payloadLength: block.payloadLength,
			previousBlock: block.previousBlock,
			generatorPublicKey: block.generatorPublicKey,
			blockSignature: block.blockSignature
		}
		res.status(200).json({
			success: true,
			height: modules.blocks.getLastBlock().height,
			header: blockheader
		});
	});

	router.use(function (req, res, next) {
		res.status(500).send({success: false, error: 'API endpoint not found'});
	});

	library.network.app.use('/peer', router);

	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

__private.hashsum = function (obj) {
	var buf = new Buffer(JSON.stringify(obj), 'utf8');
	var hashdig = crypto.createHash('sha256').update(buf).digest();
	var temp = new Buffer(8);
	for (var i = 0; i < 8; i++) {
		temp[i] = hashdig[7 - i];
	}

	return bignum.fromBuffer(temp).toString();
};

__private.banPeer = function (options) {
	modules.peers.state(options.peer.ip, options.peer.port, 0, options.clock, function (err) {
		library.logger.warn([options.code, ['Ban', options.peer.string, (options.clock / 60), 'minutes'].join(' '), options.req.method, options.req.url].join(' '));
	});
};

__private.removePeer = function (options) {
	modules.peers.remove(options.peer.ip, options.peer.port, function (err) {
		library.logger.warn([options.code, 'Removing peer', options.peer.string, options.req.method, options.req.url].join(' '));
	});
};

// Public methods
Transport.prototype.broadcast = function (config, options, cb) {
	library.logger.debug('Broadcast', options);

	config.limit = config.limit || 1;
	modules.peers.list(config, function (err, peers) {
		if (!config.all && peers.length > config.limit) {
			peers = peers.slice(0,config.limit);
		}
		if (!err) {
			async.eachLimit(peers, 3, function (peer, cb) {
				return self.getFromPeer(peer, options, cb);
			}, function (err) {
				if (cb) {
					return setImmediate(cb, null, {body: null, peer: peers});
				}
			});
		} else if (cb) {
			return setImmediate(cb, err);
		}
	});
};

Transport.prototype.getFromRandomPeer = function (config, options, cb) {
	if (typeof options === 'function') {
		cb = options;
		options = config;
		config = {};
	}
	config.limit = 1;

	// modules.loader.getNetwork(false, function (err, network) {
	// 	if (err) {
	// 		return setImmediate(cb, err);
	// 	}
	// 	return self.getFromPeer(network.peers[0], options, cb);

	async.retry(20, function (cb) {
		modules.peers.list(config, function (err, peers) {
			if (!err && peers.length) {
				return self.getFromPeer(peers[0], options, cb);
			} else {
				return setImmediate(cb, err || 'No reachable peers in db');
			}
		});
	}, function (err, results) {
		return setImmediate(cb, err, results);
	});
};

Transport.prototype.getFromPeer = function (peer, options, cb) {
	var url;

	library.logger.debug("getFromPeer", peer);

	if (options.api) {
		url = '/peer' + options.api;
	} else {
		url = options.url;
	}

	peer = modules.peers.inspect(peer);

	var req = {
		url: 'http://' + peer.ip + ':' + peer.port + url,
		method: options.method,
		headers: _.extend({}, __private.headers, options.headers),
		timeout: library.config.peers.options.timeout
	};

	if (options.data) {
		req.body = options.data;
	}

	var request = popsicle.request(req);

	request.use(popsicle.plugins.parse(['json'], false))
	.then(function (res) {
		if (res.status !== 200) {
			// Remove peer
			__private.removePeer({peer: peer, code: 'ERESPONSE ' + res.status, req: req});

			return setImmediate(cb, ['Received bad response code', res.status, req.method, req.url].join(' '));
		} else {
			var headers      = res.headers;
			    headers.ip   = peer.ip;
			    headers.port = peer.port;

			var report = library.schema.validate(headers, schema.headers);
			if (!report) {
				// Remove peer
				__private.removePeer({peer: peer, code: 'EHEADERS', req: req});

				return setImmediate(cb, ['Invalid response headers', JSON.stringify(headers), req.method, req.url].join(' '));
			}

			if (headers.nethash !== library.config.nethash) {
				// Remove peer
				__private.removePeer({peer: peer, code: 'ENETHASH', req: req});

				return setImmediate(cb, ['Peer is not on the same network', headers.nethash, req.method, req.url].join(' '));
			}

			// update the saved list of peers
			modules.peers.update({
				ip: peer.ip,
				blockheader: headers.blockheader,
				port: headers.port,
				state: 2
			}, function(){});

			// update the passed arg 'peer' with its last received state
			if(headers.blockheader){
				peer.height = headers.blockheader.height;
				peer.blockheader = headers.blockheader;
			}

			return setImmediate(cb, null, {body: res.body, peer: peer});
		}
	})
	.catch(function (err) {
		// Commenting out the code because it makes no sense since it could because node is offline
		// if (peer) {
		// 	if (err.code === 'EUNAVAILABLE' || err.code === 'ETIMEOUT') {
		// 		// Remove peer
		// 		__private.removePeer({peer: peer, code: err.code, req: req});
		// 	} else {
		// 		// Ban peer for 10 minutes
		// 		__private.banPeer({peer: peer, code: err.code, req: req, clock: 600});
		// 	}
		// }

		return setImmediate(cb, [err.code, 'Request failed', req.method, req.url].join(' '));
	});
};

// Events
Transport.prototype.onBind = function (scope) {
	modules = scope;

	__private.headers = {
		os: modules.system.getOS(),
		version: modules.system.getVersion(),
		port: modules.system.getPort(),
		nethash: modules.system.getNethash()
	};
};

Transport.prototype.onBlockchainReady = function () {
	__private.loaded = true;
};

// Transport.prototype.onSignature = function (signature, broadcast) {
// 	if (broadcast) {
// 		//no emergency for tx propagation
// 		//TODO: anyway pending signature management will be removed!!!
// 		self.broadcast({limit: 10}, {api: '/signatures', data: {signature: signature}, method: 'POST'});
// 		//library.network.io.sockets.emit('signature/change', {});
// 	}
// };

Transport.prototype.onUnconfirmedTransaction = function (transaction, broadcast) {
	if (broadcast) {
		__private.broadcastTransactions.push(transaction);
		//library.network.io.sockets.emit('transactions/change', {});
	}
};

Transport.prototype.onNewBlock = function (block, broadcast) {
	if (broadcast) {
		// we want to propagate as fast as possible only the headers unless the node generated it.
		var blockheaders = {
			id: block.id,
			height: block.height,
			version: block.version,
			totalAmount: block.totalAmount,
			totalFee: block.totalFee,
			reward: block.reward,
			payloadHash: block.payloadHash,
			timestamp: block.timestamp,
			numberOfTransactions: block.numberOfTransactions,
			payloadLength: block.payloadLength,
			previousBlock: block.previousBlock,
			generatorPublicKey: block.generatorPublicKey,
			blockSignature: block.blockSignature,
			transactions:[]
		}

		var all=false, limitbroadcast=10;

		if(modules.delegates.isActiveDelegate()){
			// I am an active delegate, I broadcast the full block
			// Rationale: I don't want to be pinged back to download the block payload
			library.logger.debug("Full block broadcasted", block.id);
			blockheaders.transactions=block.transactions;
			// I broadcast to everybody I know if I generated this block
			all=modules.delegates.isAForgingDelegatesPublicKey(block.generatorPublicKey);

			// I increase the reach if i am an active delegate;
			limitbroadcast=25;
		}

		self.broadcast({all: all, limit: limitbroadcast}, {api: '/blocks', data: {block: blockheaders}, method: 'POST'});
		//library.network.io.sockets.emit('blocks/change', {});
	}
};


Transport.prototype.cleanup = function (cb) {
	__private.loaded = false;
	return setImmediate(cb);
};


// Export
module.exports = Transport;
