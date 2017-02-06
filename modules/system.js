'use strict';

var os = require('os');

// Private fields
var modules, library, self, __private = {}, shared = {};

// Constructor
function System (cb, scope) {
	library = scope;
	self = this;

	__private.version = library.config.version;
	__private.port = library.config.port;
	__private.nethash = library.config.nethash;
	__private.osName = os.platform() + os.release();

	setImmediate(cb, null, self);
}

// Private methods

// Public methods
System.prototype.getOS = function () {
	return __private.osName;
};

System.prototype.getVersion = function () {
	return __private.version;
};

System.prototype.getPort = function () {
	return __private.port;
};

System.prototype.getNethash = function () {
	return __private.nethash;
};

// Events
System.prototype.onBind = function (scope) {
	modules = scope;
};

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
