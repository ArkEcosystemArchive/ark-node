'use strict';

var os = require('os');

// Private fields
var modules, library, self, __private = {}, shared = {};

/**
 * @param {(err: null, result: System) => *} cb
 * @param {*} scope
 */
// Constructor
function System (cb, scope) {
	library = scope;
	self = this;

	__private.version = library.config.version;
	__private.port = library.config.port;
	__private.nethash = library.config.nethash;
	__private.osName = os.platform() + os.release();

	return cb(null, self);
}

// Private methods

// Public methods

/**
 * @returns {string}
 */
//
//__API__ `getOS`

//
System.prototype.getOS = function () {
	return __private.osName;
};

/**
 * @returns {string}
 */
//
//__API__ `getVersion`

//
System.prototype.getVersion = function () {
	return __private.version;
};

/**
 * @returns {number}
 */
//
//__API__ `getPort`

//
System.prototype.getPort = function () {
	return __private.port;
};

/**
 * @returns {string}
 */
//
//__API__ `getNethash`

//
System.prototype.getNethash = function () {
	return __private.nethash;
};

// Events
//
//__EVENT__ `onBind`

//
System.prototype.onBind = function (scope) {
	modules = scope;
};

/**
 * 
 * @param {object} peer
 * @returns {boolean} 
 */
//
//__API__ `isMyself`

//
System.prototype.isMyself = function (peer) {
	var interfaces = os.networkInterfaces();
	return Object.keys(interfaces).some(function(family){
		return interfaces[family].some(function(nic){
			return nic.address == peer.ip && peer.port == __private.port;
		});
	});
}

// Shared

// Export
module.exports = System;
