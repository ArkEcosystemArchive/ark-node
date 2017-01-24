'use strict';

var _ = require('lodash');
var async = require('async');
var extend = require('extend');
var fs = require('fs');
var ip = require('ip');
var OrderBy = require('../helpers/orderBy.js');
var path = require('path');
var Router = require('../helpers/router.js');
var schema = require('../schema/peers.js');
var sql = require('../sql/peers.js');
var util = require('util');

// Private fields
var modules, library, self, __private = {}, shared = {};

// List of peers not behaving well
// reset when we restart
var removed = [];

// Constructor
function Peers (cb, scope) {
	library = scope;
	self = this;

	__private.attachApi();
	//prevents from looking too much around at coldstart
	__private.lastPeersUpdate = new Date().getTime();
	//hold the peer list
	__private.peers={};

	setImmediate(cb, null, self);
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
	if(new Date().getTime()-__private.lastPeersUpdate<60*1000){
		return setImmediate(cb);
	}
	__private.lastPeersUpdate = new Date().getTime();
	modules.transport.getFromRandomPeer({
		api: '/list',
		method: 'GET'
	}, function (err, res) {
		if (err) {
			library.logger.debug('peers validation error ', err);
			return setImmediate(cb);
		}

		library.schema.validate(res.body, schema.updatePeersList.peers, function (err) {
			if (err) {
				library.logger.debug('peers validation error ', err);
				return setImmediate(cb);
			}

			// Removing nodes not behaving well
			library.logger.debug('Removed peers: ' + removed.length);
			var peers = res.body.peers.filter(function (peer) {
					return removed.indexOf(peer.ip);
			});

			// Update only a subset of the peers to decrease the noise on the network.
			// Default is 20 peers. To be fined tuned. Node gets checked by a peer every 3s on average.
			// Maybe increasing schedule (every 60s right now).
			var maxUpdatePeers = Math.floor(library.config.peers.options.maxUpdatePeers) || 50;
			if (peers.length > maxUpdatePeers) {
				peers = peers.slice(0, maxUpdatePeers);
			}

			// Drop one random peer from removed array to give them a chance.
			// This mitigates the issue that a node could be removed forever if it was offline for long.
			// This is not harmful for the node, but prevents network from shrinking, increasing noise.
			// To fine tune: decreasing random value threshold -> reduce noise.
			if (Math.random() < 0.5) { // Every 60/0.5 = 120s
				// Remove the first element,
				// i.e. the one that have been placed first.
				removed.shift();
				removed.pop();
			}

			library.logger.debug(['Picked', peers.length, 'of', res.body.peers.length, 'peers'].join(' '));

			async.eachLimit(peers, 2, function (peer, cb) {
				peer = self.inspect(peer);

				library.schema.validate(peer, schema.updatePeersList.peer, function (err) {
					if (err) {
						err.forEach(function (e) {
							library.logger.error(['Rejecting invalid peer:', peer.ip, e.path, e.message].join(' '));
						});

						return setImmediate(cb);
					} else {
						__private.peers[peer.ip+":"+peer.port] = peer;
						return setImmediate(cb);
					}
				});
			}, cb);
		});
	});
};

__private.count = function (cb) {
	return setImmediate(cb, null, Object.keys(__private.peers).length);
};

__private.banManager = function (cb) {
	return setImmediate(cb, null, 1);
	// library.db.query(sql.banManager, { now: Date.now() }).then(function (res) {
	// 	return setImmediate(cb, null, res);
	// }).catch(function (err) {
	// 	library.logger.error(err.stack);
	// 	return setImmediate(cb, 'Peers#banManager error');
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
		return setImmediate(cb, 'Invalid limit. Maximum is 100');
	}

	var orderBy = OrderBy(
		filter.orderBy, {
			sortFields: sql.sortFields
		}
	);

	if (orderBy.error) {
		return setImmediate(cb, orderBy.error);
	}

	return self.list({},cb);

	// library.db.query(sql.getByFilter({
	// 	where: where,
	// 	sortField: orderBy.sortField,
	// 	sortMethod: orderBy.sortMethod
	// }), params).then(function (rows) {
	// 	return setImmediate(cb, null, rows);
	// }).catch(function (err) {
	// 	library.logger.error(err.stack);
	// 	return setImmediate(cb, 'Peers#getByFilter error');
	// });
};

// Public methods
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

Peers.prototype.list = function (options, cb) {
	var list = Object.keys(__private.peers).map(function (key) {
    return __private.peers[key];
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
	return setImmediate(cb, null, shuffle(list));
	// options.limit = options.limit || 100;
	//
	// library.db.query(sql.randomList(options), options).then(function (rows) {
	// 	return setImmediate(cb, null, rows);
	// }).catch(function (err) {
	// 	library.logger.error(err.stack);
	// 	return setImmediate(cb, 'Peers#list error');
	// });
};

Peers.prototype.state = function (pip, port, state, timeoutSeconds, cb) {
	var isFrozenList = _.find(library.config.peers, function (peer) {
		return peer.ip === pip && peer.port === port;
	});
	if (isFrozenList !== undefined && cb) {
		return setImmediate(cb, 'Peer in white list');
	}
	var clock;
	if (state === 0) {
		clock = (timeoutSeconds || 1) * 1000;
		clock = Date.now() + clock;
	} else {
		clock = null;
	}
	var params = {
		state: state,
		clock: clock,
		ip: pip,
		port: port
	};
	library.db.query(sql.state, params).then(function (res) {
		library.logger.debug('Updated peer state', params);
		return cb && setImmediate(cb, null, res);
	}).catch(function (err) {
		library.logger.error(err.stack);
		return cb && setImmediate(cb);
	});
};

Peers.prototype.remove = function (pip, port, cb) {
	var isFrozenList = _.find(library.config.peers.list, function (peer) {
		return peer.ip === pip && peer.port === port;
	});
	if (isFrozenList !== undefined && cb) {
		return setImmediate(cb, 'Peer in white list');
	}
	removed.push(pip);
	var params = {
		ip: pip,
		port: port
	};

	delete __private.peers[pip+":"+port];
	// library.db.query(sql.remove, params).then(function (res) {
	// 	library.logger.debug('Removed peer', params);
	// 	return cb && setImmediate(cb, null, res);
	// }).catch(function (err) {
	// 	library.logger.error(err.stack);
	// 	return cb && setImmediate(cb);
	// });
};

Peers.prototype.update = function (peer, cb) {
	// var params = {
	// 	ip: peer.ip,
	// 	port: peer.port,
	// 	os: peer.os || null,
	// 	version: peer.version || null,
	// 	state: 1
	// };

	// var query;
	// if (peer.state !== undefined) {
	// 	params.state = peer.state;
	// 	query = sql.upsertWithState;
	// } else {
	// 	query = sql.upsertWithoutState;
	// }

	if(__private.peers[(peer.ip+":"+peer.port)]){
		if(peer.blockheader){
			__private.peers[(peer.ip+":"+peer.port)] = peer;
			__private.peers[(peer.ip+":"+peer.port)].height = peer.blockheader.height;
		}
	}
	else if(parseInt(peer.port)!=1){
		__private.peers[(peer.ip+":"+peer.port)] = peer;
		library.logger.debug("New peer added", peer);
	}


	return setImmediate(cb);

	// library.db.query(query, params).then(function () {
	// 	library.logger.debug('Upserted peer', params);
	// 	return setImmediate(cb);
	// }).catch(function (err) {
	// 	library.logger.error(err.stack);
	// 	return setImmediate(cb, 'Peers#update error');
	// });
};

Peers.prototype.getFreshPeer = function(peer) {
	return __private.peers[peer.ip+":"+peer.port];
}

// Events
Peers.prototype.onBind = function (scope) {
	modules = scope;
	for(var i=0;i<library.config.peers.list.length;i++){
		var peer = library.config.peers.list[i];
		__private.peers[peer.ip+":"+peer.port] = peer;
	}
	// async.eachSeries(library.config.peers.list, function (peer, cb) {
	// 	var params = {
	// 		ip: peer.ip,
	// 		port: peer.port,
	// 		state: 2
	// 	};
	// 	library.db.query(sql.insertSeed, params).then(function (res) {
	// 		library.logger.debug('Inserted seed peer', params);
	// 		return setImmediate(cb, null, res);
	// 	}).catch(function (err) {
	// 		library.logger.error(err.stack);
	// 		return setImmediate(cb, 'Peers#onBlockchainReady error');
	// 	});
	// }, function (err) {
	// 	if (err) {
	// 		library.logger.error(err);
	// 	}
	//
	// 	__private.count(function (err, count) {
	// 		if (count) {
	// 			__private.updatePeersList(function (err) {
	// 				if (err) {
	// 					library.logger.error('Peers#updatePeersList error', err);
	// 				}
	// 				library.bus.message('peersReady');
	// 			});
	// 			library.logger.info('Peers ready, stored ' + count);
	// 		} else {
	// 			library.logger.warn('Peers list is empty');
	// 			library.bus.message('peersReady');
	// 		}
	// 	});
	// });

	__private.count(function (err, count) {
		if (count) {
			__private.updatePeersList(function (err) {
				if (err) {
					library.logger.error('Peers#updatePeersList error', err);
				}
				library.bus.message('peersReady');
			});
			library.logger.info('Peers ready, stored ' + count);
		} else {
			library.logger.warn('Peers list is empty');
			library.bus.message('peersReady');
		}
	});
};

Peers.prototype.onBlockchainReady = function () {

};

Peers.prototype.onPeersReady = function () {
	setImmediate(function nextUpdatePeersList () {
		__private.updatePeersList(function (err) {
			if (err) {
				library.logger.error('Peers timer:', err);
			}
			setTimeout(nextUpdatePeersList, 60 * 1000);
		});
	});

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
			return setImmediate(cb, err[0].message);
		}

		if (req.body.limit < 0 || req.body.limit > 100) {
			return setImmediate(cb, 'Invalid limit. Maximum is 100');
		}

		__private.getByFilter(req.body, function (err, peers) {
			if (err) {
				return setImmediate(cb, 'Failed to get peers');
			}

			return setImmediate(cb, null, {peers: peers});
		});
	});
};

shared.getPeer = function (req, cb) {
	library.schema.validate(req.body, schema.getPeer, function (err) {
		if (err) {
			return setImmediate(cb, err[0].message);
		}

		var peer = __private.peers[req.body.ip+":"+req.body.port];
		if (peer) {
			return setImmediate(cb, null, {success: true, peer: peer});
		} else {
			return setImmediate(cb, null, {success: false, error: 'Peer not found'});
		}
		// __private.getByFilter({
		// 	ip: req.body.ip,
		// 	port: req.body.port
		// }, function (err, peers) {
		// 	if (err) {
		// 		return setImmediate(cb, 'Failed to get peer');
		// 	}
		//
		// 	if (peers.length) {
		// 		return setImmediate(cb, null, {success: true, peer: peers[0]});
		// 	} else {
		// 		return setImmediate(cb, null, {success: false, error: 'Peer not found'});
		// 	}
		// });
	});
};

shared.version = function (req, cb) {
	return setImmediate(cb, null, {version: library.config.version, build: library.build});
};

// Export
module.exports = Peers;
