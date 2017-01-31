'use strict';

var arkjs = require('arkjs');
var network = arkjs.networks.ark;
var ed = {};

ed.makeKeypair = function (seed) {
	return arkjs.crypto.getKeys(seed);
};

ed.sign = function (hash, keypair) {
	return keypair.sign(hash).toDER().toString("hex");
};

ed.verify = function (hash, signatureBuffer, publicKeyBuffer) {
	try {
		var ecsignature = arkjs.ECSignature.fromDER(signatureBuffer);
		var ecpair = arkjs.ECPair.fromPublicKeyBuffer(publicKeyBuffer, network);
		return ecpair.verify(hash, ecsignature);
	} catch (error){
		return false;
	}
};

module.exports = ed;
