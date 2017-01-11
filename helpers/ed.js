'use strict';

var arkjs = require('arkjs');
var network = arkjs.networks.ark;
var ed = {};

ed.makeKeypair = function (seed) {
	//console.log(arkjs.ecpair);
	return arkjs.crypto.getKeys(seed);
};

ed.sign = function (hash, keypair) {
	return keypair.sign(hash).toDER().toString("hex");
};

ed.verify = function (hash, signatureBuffer, publicKeyBuffer) {
	try {
		var ecsignature = arkjs.ecsignature.fromDER(signatureBuffer);
		var ecpair = arkjs.ecpair.fromPublicKeyBuffer(publicKeyBuffer, network);
		return ecpair.verify(hash, ecsignature);
	} catch (error){
		return false;
	}
};

module.exports = ed;
