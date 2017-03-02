'use strict';

var ByteBuffer = require('bytebuffer');
var constants = require('../helpers/constants.js');

// Private fields
var modules, library;

// Constructor
function Signature () {}

//
//__API__ `bind`

//
Signature.prototype.bind = function (scope) {
	modules = scope.modules;
	library = scope.library;
};

//
//__API__ `create`

//
Signature.prototype.create = function (data, trs) {
	trs.recipientId = null;
	trs.amount = 0;
	trs.asset.signature = {
		publicKey: data.secondKeypair.publicKey
	};

	return trs;
};

//
//__API__ `calculateFee`

//
Signature.prototype.calculateFee = function (trs) {
	return constants.fees.secondsignature;
};

//
//__API__ `verify`

//
Signature.prototype.verify = function (trs, sender, cb) {
	if (!trs.asset || !trs.asset.signature) {
		return cb('Invalid transaction asset');
	}

	if (trs.amount !== 0) {
		return cb('Invalid transaction amount');
	}

	try {
		if (!trs.asset.signature.publicKey || new Buffer(trs.asset.signature.publicKey, 'hex').length !== 33) {
			return cb('Invalid public key');
		}
	} catch (e) {
		library.logger.error("stack", e.stack);
		return cb('Invalid public key');
	}

	return cb(null, trs);
};

//
//__API__ `process`

//
Signature.prototype.process = function (trs, sender, cb) {
	return cb(null, trs);
};

//
//__API__ `getBytes`

//
Signature.prototype.getBytes = function (trs) {
	var bb;

	try {
		bb = new ByteBuffer(33, true);
		var publicKeyBuffer = new Buffer(trs.asset.signature.publicKey, 'hex');

		for (var i = 0; i < publicKeyBuffer.length; i++) {
			bb.writeByte(publicKeyBuffer[i]);
		}

		bb.flip();
	} catch (e) {
		throw e;
	}
	return bb.toBuffer();
};

//
//__API__ `apply`

//
Signature.prototype.apply = function (trs, block, sender, cb) {
	modules.accounts.setAccountAndGet({
		address: sender.address,
		secondSignature: 1,
		u_secondSignature: 0,
		secondPublicKey: trs.asset.signature.publicKey
	}, cb);
};

//
//__API__ `undo`

//
Signature.prototype.undo = function (trs, block, sender, cb) {
	modules.accounts.setAccountAndGet({
		address: sender.address,
		secondSignature: 0,
		u_secondSignature: 1,
		secondPublicKey: null
	}, cb);
};

//
//__API__ `applyUnconfirmed`

//
Signature.prototype.applyUnconfirmed = function (trs, sender, cb) {
	if (sender.u_secondSignature || sender.secondSignature) {
		return cb('Failed second signature: ' + trs.id);
	}

	modules.accounts.setAccountAndGet({address: sender.address, u_secondSignature: 1}, cb);
};

//
//__API__ `undoUnconfirmed`

//
Signature.prototype.undoUnconfirmed = function (trs, sender, cb) {
	modules.accounts.setAccountAndGet({address: sender.address, u_secondSignature: 0}, cb);
};

Signature.prototype.schema = {
	id: 'Signature',
	object: true,
	properties: {
		publicKey: {
			type: 'string',
			format: 'publicKey'
		}
	},
	required: ['publicKey']
};

//
//__API__ `objectNormalize`

//
Signature.prototype.objectNormalize = function (trs) {
	var report = library.schema.validate(trs.asset.signature, Signature.prototype.schema);

	if (!report) {
		throw 'Failed to validate signature schema: ' + this.scope.schema.getLastErrors().map(function (err) {
			return err.message;
		}).join(', ');
	}

	return trs;
};

//
//__API__ `dbRead`

//
Signature.prototype.dbRead = function (raw) {
	if (!raw.s_publicKey) {
		return null;
	} else {
		var signature = {
			transactionId: raw.t_id,
			publicKey: raw.s_publicKey
		};

		return {signature: signature};
	}
};

Signature.prototype.dbTable = 'signatures';

Signature.prototype.dbFields = [
	'transactionId',
	'publicKey'
];

//
//__API__ `dbSave`

//
Signature.prototype.dbSave = function (trs) {
	var publicKey;

	try {
		publicKey = new Buffer(trs.asset.signature.publicKey, 'hex');
	} catch (e) {
		throw e;
	}

	return {
		table: this.dbTable,
		fields: this.dbFields,
		values: {
			transactionId: trs.id,
			publicKey: publicKey
		}
	};
};

//
//__API__ `ready`

//
Signature.prototype.ready = function (trs, sender) {
	if (Array.isArray(sender.multisignatures) && sender.multisignatures.length) {
		if (!Array.isArray(trs.signatures)) {
			return false;
		}
		return trs.signatures.length >= sender.multimin;
	} else {
		return true;
	}
};

// Export
module.exports = Signature;
