'use strict';

var _ = require('lodash');
var async = require('async');
var bignum = require('../helpers/bignum.js');
var crypto = require('crypto');
var extend = require('extend');
var ip = require('ip');
var popsicle = require('popsicle');
var Router = require('../helpers/router.js');
var slots = require('../helpers/slots.js');
var schema = require('../schema/transport.js');
var sql = require('../sql/transport.js');
var zlib = require('zlib');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.headers = {};
__private.messages = {};
__private.broadcastTransactions = [];

// Constructor
function Transport (cb, scope) {
	library = scope;
	self = this;

	setInterval(function(){
		if(__private.broadcastTransactions.length > 0){
			var transactions = __private.broadcastTransactions;
			if(__private.broadcastTransactions.length > 10){
				transactions = __private.broadcastTransactions.splice(0,10);
			}
			else{
				__private.broadcastTransactions=[];
			}
			self.broadcast({limit: 5}, {api: '/transactions', data: {transactions: transactions}, method: 'POST'});
		}
	}, 3000);

	cb(null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if(modules) { return next(); }
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
			return res.status(500).send({success: false, error: 'Invalid request headers'});
		}

		var headers      = req.headers;
		    headers.ip   = req.peer.ip;
		    headers.port = req.peer.port;

		req.sanitize(headers, schema.headers, function (err, report) {
			if(err) { return next(err); }
			if(!report.isValid) {
				return res.status(500).send({status: false, error: report.issues});
			}

			if(headers.nethash !== library.config.nethash) {
				__private.removePeer({peer: req.peer, code: 'ENETHASH', req: req});
				return res.status(500).send({success: false, message: 'Request is made on the wrong network', expected: library.config.nethash, received: headers.nethash});
			}

			req.peer.os = headers.os;
			req.peer.version = headers.version;

			modules.peers.accept(req.peer);

			return next();
		});
	});

	router.get('/list', function (req, res) {
		res.set(__private.headers);
		var peers = modules.peers.listBroadcastPeers();
		peers = peers.map(function(peer){return peer.toObject()});
		return res.status(200).json({success:true, peers: peers});
	});

	router.get('/blocks/common', function (req, res, next) {
		res.set(__private.headers);

		req.sanitize(req.query, schema.commonBlock, function (err, report, query) {
			if (err) { return next(err); }
			if (!report.isValid) { return res.json({success: false, error: report.issues}); }

			var escapedIds = query.ids
				// Remove quotes
				.replace(/['"]+/g, '') //'
				// Separate by comma into an array
				.split(',')
				// Reject any non-byte values
				.filter(function (id) {
					return /^[0-9a-f]+$/.test(id);
				});

			if (!escapedIds.length) {
				library.logger.warn('Invalid common block request, ban 60 min', req.peer.string);

				return res.json({success: false, error: 'Invalid block id sequence'});
			}

			var lastBlock = modules.blockchain.getLastBlock()
			library.db.query(sql.getCommonBlock, escapedIds).then(function (rows) {
				return res.json({ success: true, common: rows[0] || null, lastBlockHeight: (lastBlock ? lastBlock.height : 0) });
			}).catch(function (err) {
				library.logger.error("error",err.stack);
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
			var limit=400;

			//if forging send a small bunch only to prevent from being overloaded.
			if(modules.delegates.isActiveDelegate()){
				limit=100;
			}

			library.db.query(sql.blockList, {
				lastBlockHeight: query.lastBlockHeight,
				limit: limit
			}).then(function (rows) {
				res.status(200);
				res.json({success:true, blocks: rows});
			}).catch(function (err) {
				library.logger.error("Error getting blocks from DB", err);
				res.status(500);
				return res.json({success:false, blocks: []});
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


		try {
			block = library.logic.block.objectNormalize(block);
		} catch (e) {
			var id = (block ? block.id : 'null');
			library.logger.error(['Block', id].join(' '), e.toString());
			if (block) { library.logger.error('Block', block); }

			if (req.peer) {
				// Ban peer for 60 minutes
				__private.banPeer({peer: req.peer, code: 'EBLOCK', req: req, clock: 3600});
			}

			return res.status(200).json({success: false, error: e.toString()});
		}

		modules.peers.accept(req.peer);


		library.bus.message('blockReceived', block, req.peer, function(error, data){
			if(error){
				library.logger.error(error, data);
			}
		});

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
	// 	var unconfirmedList = modules.transactionPool.getUnconfirmedTransactionList();
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
		res.status(200).json({success: true, transactions: modules.transactionPool.getUnconfirmedTransactionList()});
	});

	router.get('/transactionsFromIds', function (req, res) {
		res.set(__private.headers);
		req.sanitize(req.query, schema.transactionsFromIds, function (err, report, query) {
			if (err) { return next(err); }
			if (!report.isValid) { return res.json({success: false, error: report.issues}); }
			var escapedIds = req.query.ids
				// Remove quotes
				.replace(/['"]+/g, '') //'
				// Separate by comma into an array
				.split(',')
				// Reject any non-byte values
				.filter(function (id) {
					return /^[0-9a-f]+$/.test(id);
				});

			for(var i in escapedIds){
				escapedIds[i]=modules.transactionPool.getTransactionFromMempool(escapedIds[i]);
			}
			res.status(200).json({success: true, transactions: escapedIds});
			// modules.blocks.getTransactionsFromIds(query.blockid,escapedIds,function(err, transactions){
			// 	if(err){
			// 		res.status(200).json({success: false, message: err.toString()});
			// 	}
			// 	else{
			// 		res.status(200).json({success: true, transactions: transactions});
			// 	}
			// });
		});
	});

	router.post('/transactions', function (req, res) {
		res.set(__private.headers);
		var transactions = req.body.transactions;
		var peer=req.peer;

		library.bus.message("transactionsReceived", transactions, "network", function(error, receivedtransactions){
			if(error){
				return res.status(200).json({success: false, message: 'Invalid transaction detected', error: error.toString()});
			}
			else{
				if(!receivedtransactions){
					receivedtransactions=[];
				}
				res.status(200).json({success: true, transactionIds: receivedtransactions.map(function(t){return t.id;})});
			}
		});
	});

	router.get('/height', function (req, res) {
		res.set(__private.headers);
		var block = modules.blockchain.getLastBlock();
		var blockheader={
			id: block.id,
			height: block.height,
			version: block.version,
			totalAmount: block.totalAmount,
			totalFee: block.totalFee,
			reward: block.reward,
			payloadHash: block.payloadHash,
			payloadLength: block.payloadLength,
			timestamp: block.timestamp,
			numberOfTransactions: block.numberOfTransactions,
			previousBlock: block.previousBlock,
			generatorPublicKey: block.generatorPublicKey,
			blockSignature: block.blockSignature
		}
		res.status(200).json({
			success: true,
			height: block.height,
			header: blockheader
		});
	});

	router.get('/status', function (req, res) {
		res.set(__private.headers);
		var block = modules.blockchain.getLastBlock();
		var blockheader = {
			id: block.id,
			height: block.height,
			version: block.version,
			totalAmount: block.totalAmount,
			totalFee: block.totalFee,
			reward: block.reward,
			payloadHash: block.payloadHash,
			payloadLength: block.payloadLength,
			timestamp: block.timestamp,
			numberOfTransactions: block.numberOfTransactions,
			previousBlock: block.previousBlock,
			generatorPublicKey: block.generatorPublicKey,
			blockSignature: block.blockSignature
		}
		res.status(200).json({
			success: true,
			height: block.height,
			forgingAllowed: slots.isForgingAllowed(),
			currentSlot: slots.getSlotNumber(),
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
	//TODO
};

__private.removePeer = function (options) {
	//TODO
};

// Public methods
//
//__API__ `broadcast`

//
Transport.prototype.broadcast = function (config, options, cb) {
	library.logger.debug('Broadcast', ["API:", options.api, "METHOD:", options.method, "DATA:", Object.keys(options.data).join(",")].join(" "));

	config.limit = config.limit || 1;

	var peers = modules.peers.listBroadcastPeers();

	if (!config.all && peers.length > config.limit) {
		peers = peers.slice(0,config.limit);
	}
	// TODO: use a good bloom filter lib
	// filtering out the peers likely already reached
	async.each(peers, function (peer, cb) {
		if(!modules.system.isMyself(peer)){
			return self.requestFromPeer(peer, options, cb);
		}
		else{
			return cb();
		}
	}, cb);
};

//
//__API__ `requestFromRandomPeer`

//
Transport.prototype.requestFromRandomPeer = function (config, options, cb) {
	if (typeof options === 'function') {
		cb = options;
		options = config;
		config = {};
	}
	config.limit = 1;

	async.retry(20, function (cb) {
		var peers = modules.peers.listGoodPeers();
		if (peers.length) {
			return self.requestFromPeer(peers[0], options, cb);
		} else {
			return cb('No peers stored');
		}
	}, function (err, results) {
		return cb(err, results);
	});
};

//
//__API__ `requestFromPeer`

//
Transport.prototype.requestFromPeer = function (peer, options, cb) {
	var url;
	peer = modules.peers.accept(peer);
	library.logger.trace("requestFromPeer", peer.toObject());

	if (options.api) {
		url = '/peer' + options.api;
	} else {
		url = options.url;
	}

	return peer.request(url, options, cb);
};

// Events
//
//__EVENT__ `onBind`

//
Transport.prototype.onBind = function (scope) {
	modules = scope;

	__private.headers = {
		os: modules.system.getOS(),
		version: modules.system.getVersion(),
		port: modules.system.getPort(),
		nethash: modules.system.getNethash()
	};
};

//
//__EVENT__ `onBlockchainReady`

//
Transport.prototype.onBlockchainReady = function () {

};

//
//__EVENT__ `onAttachNetworkApi`

//
Transport.prototype.onAttachNetworkApi = function () {
	__private.attachApi();
	library.bus.message("NetworkApiAttached");
};


//
//__EVENT__ `onSignature`

//
// Transport.prototype.onSignature = function (signature, broadcast) {
// 	if (broadcast) {
// 		//no emergency for tx propagation
// 		//TODO: anyway pending signature management will be removed!!!
// 		self.broadcast({limit: 10}, {api: '/signatures', data: {signature: signature}, method: 'POST'});
// 		//library.network.io.sockets.emit('signature/change', {});
// 	}
// };

//
//__EVENT__ `onBroadcastTransaction`

//
Transport.prototype.onBroadcastTransaction = function (transaction) {
	// clone as we don't want to send all object
	transaction=JSON.parse(JSON.stringify(transaction));
	delete transaction.broadcast;
	delete transaction.verified;
	delete transaction.processed;

	__private.broadcastTransactions.push(transaction);
};

//
//__EVENT__ `onBroadcastBlock`

//
Transport.prototype.onBroadcastBlock = function (block) {
	// we want to propagate as fast as possible only the headers unless the node generated it.
	// var bloomfilter;
	// if(block.bloomfilter){
	// 	bloomfilter = BloomFilter.create(numberofElements, falsePositiveRate);
	// }
	// else {
	// 	bloomfilter = new BloomFilter(serialized);
	// }

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

	var limitbroadcast=15;

	if(modules.delegates.isActiveDelegate()){
		// I increase the reach if i am an active delegate;
		limitbroadcast=30;
	}
	if(block.numberOfTransactions>0){//i send only ids, because nodes likely have already transactions in mempool.
		blockheaders.transactionIds=block.transactions.map(function(t){return t.id});

	}

	self.broadcast({all: block.forged, limit: limitbroadcast}, {api: '/blocks', data: {block: blockheaders}, method: 'POST'});
};


//
//__API__ `cleanup`

//
Transport.prototype.cleanup = function (cb) {
	return cb();
};


// Export
module.exports = Transport;
