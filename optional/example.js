'use strict';

var Router = require('../helpers/router.js');

// Private fields
var modules, library, self, __private = {};

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

	library.network.app.use('/app', router);
};

//
Server.prototype.onBind = function (scope) {
	modules = scope;
};

//
Server.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};


//
Server.prototype.cleanup = function (cb) {
	return cb();
};

// Shared

// Export
module.exports = Server;
