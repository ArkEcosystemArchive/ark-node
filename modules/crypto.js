'use strict';

var crypto = require('crypto');
var fs = require('fs');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.loaded = false;

// Constructor
function Crypto (cb, scope) {
	library = scope;
	self = this;

	setImmediate(cb, null, self);
}

// Events
Crypto.prototype.onBind = function (scope) {
	modules = scope;
};

// Crypto.prototype.onBlockchainReady = function () {
// 	__private.loaded = true;
// };

// Shared
module.exports = Crypto;
