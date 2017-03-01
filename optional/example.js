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

	router.use(function (req, res, next) {
		if (modules) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.get('/', function (req, res) {
		res.render('./example.pug', {nethash: library.config.nethash, lastBlock: modules.blockchain.getLastBlock()});
	});

	router.use(function (req, res, next) {
		if (req.url.indexOf('/api/') === -1 && req.url.indexOf('/peer/') === -1) {
			return res.redirect('/');
		}
		next();
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
