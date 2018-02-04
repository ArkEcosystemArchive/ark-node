'use strict';

var arkjs = require('arkjs');

/**
 * @external arkjs
 * @see {@link https://github.com/ArkEcosystem/ark-js|arkjs}
 */

/**
 * @class ECPair
 * @memberof external:arkjs
 */

/**
 * @constructor
 * @param {*} scope 
 */
function Crypto(scope){
	this.scope = scope;
	this.network = scope.config.network;
}

/**
 * @param {string} seed
 * @returns {ECPair}
 */
Crypto.prototype.makeKeypair = function (seed) {
	return arkjs.crypto.getKeys(seed, this.network);
};

/**
 * @param {Buffer} hash
 * @param {arkjs.ECPair} keypair
 * @returns {string}
 */
Crypto.prototype.sign = function (hash, keypair) {
	return keypair.sign(hash).toDER().toString("hex");
};

/**
 * @param {Buffer} hash
 * @param {Buffer} signatureBuffer
 * @param {Buffer} publicKeyBuffer
 * @returns {boolean}
 */
Crypto.prototype.verify = function (hash, signatureBuffer, publicKeyBuffer) {
	try {
		var ecsignature = arkjs.ECSignature.fromDER(signatureBuffer);
		var ecpair = arkjs.ECPair.fromPublicKeyBuffer(publicKeyBuffer, this.network);
		return ecpair.verify(hash, ecsignature);
	} catch (error){
		return false;
	}
};

module.exports = Crypto;
