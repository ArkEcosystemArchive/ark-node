'use strict';

var async = require('async');
var path = require('path');
var Router = require('../helpers/router.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

// Constructor
function Server (cb, scope) {
	library = scope;
	self = this;

	return cb(null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.get('/', function (req, res) {
		res.render('./example.pug', {nethash: library.config.nethash});
	});

	router.get('/getStats', function (req, res) {
		res.status(200).send({
			lastBlock: modules.blockchain.getLastBlock(),
			transactionPool: modules.transactionPool.getMempoolSize()
		});
	});

	library.network.app.engine('pug', require('pug').__express);

	library.network.app.use('/', router);
};

// Public methods

// Events
//
//__EVENT__ `onBind`

//
Server.prototype.onBind = function (scope) {
	modules = scope;
};

//
//__EVENT__ `onAttachPublicApi`

//
Server.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};

//
//__API__ `cleanup`

//
Server.prototype.cleanup = function (cb) {
	return cb();
};

// Shared

// Export
module.exports = Server;
