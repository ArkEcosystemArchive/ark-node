'use strict';

var _ = require('lodash');
var async = require('async');
var extend = require('extend');
var fs = require('fs');
var ip = require('ip');
var popsicle = require('popsicle');
var OrderBy = require('../helpers/orderBy.js');
var path = require('path');
var Router = require('../helpers/router.js');
var schema = require('../schema/peers.js');
var sql = require('../sql/peers.js');
var util = require('util');

// Private fields
var modules, library, self, shared = {};

var __private = {
	// prevents from looking too much around at coldstart
	lastPeersUpdate: new Date().getTime(),

	// not banning at the start of nodes
	coldstart: new Date().getTime(),

	// hold the peer list
	peers: {},

	// headers to send to peers
	headers: {}
};

// Constructor
function Peers (cb, scope) {
	library = scope;
	self = this;

	return cb(null, self);
}

// single Peer object
function Peer(ip, port, version, os){
	this.ip = ip;
	this.port = port;
	this.version = version;
	this.os = os;
	this.protocol = (port%1000)==443?"https":"http";
	this.liteclient = port < 80;
	this.status = "NEW";
	this.publicapi = false;
	this.headers;

	this.requests = 0;
	this.delay = 10000;
	this.lastchecked = 0;

	Peer.prototype.toObject = function(){
		return {
			ip: this.ip,
			port: this.port,
			version: this.version,
			os: this.os,
			height: this.height
		};
	};

	Peer.prototype.toString = function(){
		return this.ip+":"+this.port;
	};

	Peer.prototype.normalizeHeader = function(header){
		var result = {
			height: parseInt(header.height),
			port: parseInt(header.port),
			os: header.os,
			version: header.version,
			nethash: header.nethash
		};
		if(header.blockheader){
			result.blockheader = {
				id: header.blockheader.id,
				timestamp: header.blockheader.timestamp,
				signature: header.blockheader.signature,
				generatorPublicKey: header.blockheader.generatorPublicKey,
				version: header.blockheader.version,
				height: header.blockheader.height,
				numberOfTransactions: header.blockheader.numberOfTransactions,
				previousBlock: header.blockheader.previousBlock,
				totalAmount: header.blockheader.totalAmount,
				totalFee: header.blockheader.totalFee,
				reward: header.blockheader.reward,
				payloadLength: header.blockheader.payloadLength,
				payloadHash: header.blockheader.payloadHash
			};
		}
		return result;
	};

	Peer.prototype.updateStatus = function(){
		var that = this;
		this.get('/api/blocks/getHeight', function(err, body){
			that.publicapi = !!err;
		});
		this.get('/peer/height', function(err, res){
			if(!err){
				that.height = res.body.height;
				that.headers = res.body.header;
				var lastBlock = modules.blockchain.getLastBlock();
				if(that.height > lastBlock.height && res.body.header.timestamp > lastBlock.timestamp){
					that.status="FORK";
				} else{
					that.status="OK";
				}
			}
			else{
				library.logger.trace(err);
			}
		});
	};

	Peer.prototype.accept = function(){
		this.lastchecked=new Date().getTime();
		return true;
	};

	Peer.prototype.get = function(api, cb){
		return this.request(api, {method:'GET'}, cb);
	};

	Peer.prototype.post = function(api, payload, cb){
		return this.request(api, {method:'POST', data:payload}, cb);
	};

	Peer.prototype.request = function(api, options, cb){
		library.logger.trace("request", api);
		var req = {
			url: this.protocol+'://' + this.ip + ':' + this.port + api,
			method: options.method,
			headers: _.extend({}, __private.headers, options.headers),
			timeout: options.timeout || library.config.peers.options.timeout
		};

		if (options.data) {
			req.body = options.data;
		}

		var request = popsicle.request(req);
		this.lastchecked=new Date().getTime();
		var that = this;
		request.use(popsicle.plugins.parse(['json'], false)).then(function (res) {
			that.delay=new Date().getTime()-that.lastchecked;
			if (res.status !== 200) {
				that.status="ERESPONSE";
				return cb(['Received bad response code', res.status, req.method, req.url].join(' '));
			} else {

				var header = that.normalizeHeader(res.headers);
				var report = library.schema.validate(header, schema.headers);

				if (!report) {
					// no valid transport header, considering a public API call
					if(that.status!="FORK"){
						that.status = "OK";
					}
					return cb(null, {body: res.body, peer: that.toObject()});
				}

				that.headers = header.blockheader;
				that.os = header.os;
				that.version = header.version;
				that.height = header.height;
				that.nethash = header.nethash;

				if (header.nethash !== library.config.nethash) {
					that.status="ENETHASH";
					return cb(['Peer is not on the same network', header.nethash, req.method, req.url].join(' '));
				}

				if(that.status!="FORK"){
					that.status = "OK";
				}

				return cb(null, {body: res.body, peer: that.toObject()});
			}
		})
		.catch(function (err) {
			if (err.code === 'EUNAVAILABLE' || err.code === 'ETIMEOUT') {
				that.status=err.code;
			}

			return cb([err.code, 'Request failed', req.method, req.url].join(' '));
		});
	};

	if(!this.liteclient){
		this.updateStatus();
		var that = this;
		this.intervalId = setInterval(
			function(){
				if(new Date().getTime() - that.lastchecked > 60000){
					that.updateStatus();
				}
			}, 60000);
	}
}

Peers.prototype.accept = function(peer){
	if(__private.peers[peer.ip+":"+peer.port]){
		return __private.peers[peer.ip+":"+peer.port];
	}
	else {
		__private.peers[peer.ip+":"+peer.port] = new Peer(peer.ip, peer.port, peer.version, peer.os);
		return __private.peers[peer.ip+":"+peer.port];
	}
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.map(shared, {
		'get /': 'getPeers',
		'get /version': 'version',
		'get /get': 'getPeer'
	});

	router.use(function (req, res) {
		res.status(500).send({success: false, error: 'API endpoint not found'});
	});

	library.network.app.use('/api/peers', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

__private.updatePeersList = function (cb) {
	library.logger.debug('updating Peers List...');
	__private.lastPeersUpdate = new Date().getTime();
	modules.transport.getFromRandomPeer({
		api: '/list',
		method: 'GET'
	}, function (err, res) {
		if (err) {
			library.logger.debug('peers validation error ', err);
			return cb();
		}

		library.schema.validate(res.body, schema.updatePeersList.peers, function (err) {
			if (err) {
				library.logger.debug('peers validation error ', err);
				return cb();
			}

			var peers = res.body.peers;

			async.each(peers, function (peer, eachCb) {
				peer = self.inspect(peer);

				library.schema.validate(peer, schema.updatePeersList.peer, function (err) {
					if (err) {
						err.forEach(function (e) {
							console.log(peer);
							library.logger.error(['Rejecting invalid peer:', peer.ip, e.path, e.message].join(' '));
						});

						return eachCb();
					} else {
						if(!__private.peers[peer.ip+":"+peer.port]){
							__private.peers[peer.ip+":"+peer.port] = new Peer(peer.ip, peer.port, peer.version, peer.os);
						};
						return eachCb();
					}
				});
			}, cb);
		});
	});
};

__private.count = function(){
	return Object.keys(__private.peers).length;
};

__private.banManager = function (cb) {
	return cb(null, 1);
	// library.db.query(sql.banManager, { now: Date.now() }).then(function (res) {
	// 	return cb(null, res);
	// }).catch(function (err) {
	// 	library.logger.error("stack", err.stack);
	// 	return cb('Peers#banManager error');
	// });
};

__private.getByFilter = function (filter, cb) {
	var where = [];
	var params = {};

	if (filter.state) {
		where.push('"state" = ${state}');
		params.state = filter.state;
	}

	if (filter.os) {
		where.push('"os" = ${os}');
		params.os = filter.os;
	}

	if (filter.version) {
		where.push('"version" = ${version}');
		params.version = filter.version;
	}

	if (filter.ip) {
		where.push('"ip" = ${ip}');
		params.ip = filter.ip;
	}

	if (filter.port) {
		where.push('"port" = ${port}');
		params.port = filter.port;
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
		return cb('Invalid limit. Maximum is 100');
	}

	var orderBy = OrderBy(
		filter.orderBy, {
			sortFields: sql.sortFields
		}
	);

	if (orderBy.error) {
		return cb(orderBy.error);
	}

	return self.list({},cb);
};

// Public methods
//
//__API__ `inspect`

//
Peers.prototype.inspect = function (peer) {
	if(peer == -1){
		return {};
	}
	if (/^[0-9]+$/.test(peer.ip)) {
		peer.ip = ip.fromLong(peer.ip);
	}
	if(peer.port){
		peer.port = parseInt(peer.port);
	}

	if (peer.ip) {
		peer.string = (peer.ip + ':' + peer.port || 'unknown');
	} else {
		peer.string = 'unknown';
	}

	peer.os = peer.os || 'unknown';
	peer.version = peer.version || '0.0.0';

	return peer;
};

// send peers, with in priority peers that seems to be in same chain
//
//__API__ `list`

//
Peers.prototype.list = function (options, cb) {

	var peers=Object.keys(__private.peers);

	var list = peers.map(function (key) {
    return __private.peers[key];
	}).filter(function(peer){
		return peer.status[0]!="OK";
	});

	function shuffle(array) {
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

	list = shuffle(list);

	return cb(null, list);
};


// Events
//
//__EVENT__ `onBind`

//
Peers.prototype.onBind = function (scope) {
	modules = scope;
	for(var i=0;i<library.config.peers.list.length;i++){
		var peer = library.config.peers.list[i];
		__private.peers[peer.ip+":"+peer.port] = new Peer(peer.ip, peer.port);
	}

	__private.headers = {
		os: modules.system.getOS(),
		version: modules.system.getVersion(),
		port: modules.system.getPort(),
		nethash: modules.system.getNethash()
	};

	setImmediate(function nextUpdate () {
		__private.updatePeersList(function (err) {
			if (err) {
				library.logger.error('Error while updating the list of peers', err);
			}
			setTimeout(nextUpdate, 60 * 1000);
		});
	});
};


//
//__EVENT__ `onAttachPublicApi`

//
Peers.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};

//
//__EVENT__ `onUpdatePeers`

//
Peers.prototype.onUpdatePeers = function () {
	__private.updatePeersList(function (err) {
		if (err) {
			library.logger.error('Error while updating the list of peers:', err);
		}
		library.bus.message('peersUpdated');
	});
};

//
//__EVENT__ `onPeersReady`

//
Peers.prototype.onPeersReady = function () {

	setImmediate(function nextBanManager () {
		__private.banManager(function (err) {
			if (err) {
				library.logger.error('Ban manager timer:', err);
			}
			setTimeout(nextBanManager, 65 * 1000);
		});
	});
};

// Shared

shared.getPeers = function (req, cb) {
	library.schema.validate(req.body, schema.getPeers, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		if (req.body.limit < 0 || req.body.limit > 100) {
			return cb('Invalid limit. Maximum is 100');
		}

		__private.getByFilter(req.body, function (err, peers) {
			if (err) {
				return cb('Failed to get peers');
			}
			peers=peers.map(function(peer){return peer.toObject()});
			return cb(null, {peers: peers});
		});
	});
};

shared.getPeer = function (req, cb) {
	library.schema.validate(req.body, schema.getPeer, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var peer = __private.peers[req.body.ip+":"+req.body.port];
		if (peer) {
			return cb(null, {success: true, peer: peer.toObject()});
		} else {
			return cb(null, {success: false, error: 'Peer not found'});
		}
		// __private.getByFilter({
		// 	ip: req.body.ip,
		// 	port: req.body.port
		// }, function (err, peers) {
		// 	if (err) {
		// 		return cb('Failed to get peer');
		// 	}
		//
		// 	if (peers.length) {
		// 		return cb(null, {success: true, peer: peers[0]});
		// 	} else {
		// 		return cb(null, {success: false, error: 'Peer not found'});
		// 	}
		// });
	});
};

shared.version = function (req, cb) {
	return cb(null, {version: library.config.version, build: library.build});
};

// Export
module.exports = Peers;
