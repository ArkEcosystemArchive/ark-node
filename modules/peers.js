'use strict';

var _ = require('lodash');
var async = require('async');
var extend = require('extend');
var fs = require('fs');
var ip = require('ip');
var path = require('path');
var Router = require('../helpers/router.js');
var Peer = require('../logic/peer.js');
var schema = require('../schema/peers.js');

// Private fields
var modules, library, self, shared = {};

var __private = {
	// prevents from looking too much around at coldstart
	lastPeersUpdate: new Date().getTime(),

	// not banning at the start of nodes
	coldstart: new Date().getTime(),

	// hold the Peer list
	// By default one peer by IP is accepted.
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

// Public methods
//
//__API__ `inspect`

// Return a Peer object, trying to sort out with lite clients
// By default one Peer by IP is accepted.
Peers.prototype.accept = function(peer){
	var candidate;
	if(__private.peers[peer.ip]){
		 candidate = __private.peers[peer.ip];
		if(candidate.liteclient && peer.port>79){
			candidate = new Peer(peer.ip, peer.port, peer.version, peer.os);
			__private.peers[peer.ip] = candidate;
		}
		candidate.unban();
	}
	else {
		candidate = new Peer(peer.ip, peer.port, peer.version, peer.os);
		__private.peers[peer.ip] = candidate;
	}
	return candidate;
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
	modules.transport.requestFromRandomPeer({
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
							library.logger.error(['Rejecting invalid peer:', peer.ip, e.path, e.message].join(' '));
						});

						return eachCb();
					} else {
						self.accept(peer);
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

//
//__API__ `listGoodPeers`

// send peers, with in priority peers that have good response time
Peers.prototype.listGoodPeers = function() {

	var peers = Object.values(__private.peers);

	var list = peers.filter(function(peer){
		return peer.delay < 2000;
	});

	return shuffle(list);
};

//
//__API__ `listPBFTPeers`

// send peers, with in priority peers that have good response time and on same chain
Peers.prototype.listPBFTPeers = function() {

	var peers = Object.values(__private.peers);

	var list = peers.filter(function(peer){
		return peer.status!="FORK" && peer.delay < 2000;
	});

	return shuffle(list);
};

//
//__API__ `listBroadcastPeers`

// send peers, with in priority peers that seems to be in same chain
Peers.prototype.listBroadcastPeers = function() {

	var peers = Object.values(__private.peers);

	var list = peers.filter(function(peer){
		return peer.status != "FORK" && !peer.liteclient && peer.counterror < 8;
	});

	return shuffle(list);
};


// Events
//
//__EVENT__ `onBind`

//
Peers.prototype.onBind = function (scope) {
	modules = scope;
	Peer.bind({modules: modules, library: library});

	for(var i=0;i<library.config.peers.list.length;i++){
		var peer = library.config.peers.list[i];
		peer = self.accept(peer);
		peer.status = "OK";
		peer.delay = 0;
	}

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

		var peers = self.listBroadcastPeers();
		peers = peers.map(function(peer){return peer.toObject()});
		return cb(null, {peers: peers});
	});
};

shared.getPeer = function (req, cb) {
	library.schema.validate(req.body, schema.getPeer, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var peer = __private.peers[req.body.ip];
		if (peer) {
			return cb(null, {success: true, peer: peer.toObject()});
		} else {
			return cb(null, {success: false, error: 'Peer not found'});
		}

	});
};

shared.version = function (req, cb) {
	return cb(null, {version: library.config.version, build: library.build});
};

// Export
module.exports = Peers;
