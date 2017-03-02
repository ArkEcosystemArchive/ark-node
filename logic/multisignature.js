'use strict';

var async = require('async');
var ByteBuffer = require('bytebuffer');
var constants = require('../helpers/constants.js');
var Diff = require('../helpers/diff.js');

// Private fields
var modules, library, __private = {};

__private.unconfirmedSignatures = {};

// Constructor
function Multisignature () {}

// Public methods
//
//__API__ `bind`

//
Multisignature.prototype.bind = function (scope) {
	modules = scope.modules;
	library = scope.library;
};

//
//__API__ `create`

//
Multisignature.prototype.create = function (data, trs) {
	trs.recipientId = null;
	trs.amount = 0;
	trs.asset.multisignature = {
		min: data.min,
		keysgroup: data.keysgroup,
		lifetime: data.lifetime
	};

	return trs;
};

//
//__API__ `calculateFee`

//
Multisignature.prototype.calculateFee = function (trs) {
	return (trs.asset.multisignature.keysgroup.length + 1) * constants.fees.multisignature;
};

//
//__API__ `verify`

//
Multisignature.prototype.verify = function (trs, sender, cb) {
	if (!trs.asset || !trs.asset.multisignature) {
		return cb('Invalid transaction asset');
	}

	if (!Array.isArray(trs.asset.multisignature.keysgroup)) {
		return cb('Invalid multisignature keysgroup. Must be an array');
	}

	if (trs.asset.multisignature.keysgroup.length === 0) {
		return cb('Invalid multisignature keysgroup. Must not be empty');
	}

	if (trs.asset.multisignature.min <= 1 || trs.asset.multisignature.min > 16) {
		return cb('Invalid multisignature min. Must be between 1 and 16');
	}

	if (trs.asset.multisignature.min > trs.asset.multisignature.keysgroup.length) {
		return cb('Invalid multisignature min. Must be less than keysgroup size');
	}

	if (trs.asset.multisignature.lifetime < 1 || trs.asset.multisignature.lifetime > 72) {
		return cb('Invalid multisignature lifetime. Must be between 1 and 72');
	}

	if (this.ready(trs, sender)) {
		try {
			for (var s = 0; s < trs.asset.multisignature.keysgroup.length; s++) {
				var valid = false;

				if (trs.signatures) {
					for (var d = 0; d < trs.signatures.length && !valid; d++) {
						if (trs.asset.multisignature.keysgroup[s][0] !== '-' && trs.asset.multisignature.keysgroup[s][0] !== '+') {
							valid = false;
						} else {
							valid = library.logic.transaction.verifySignature(trs, trs.asset.multisignature.keysgroup[s].substring(1), trs.signatures[d]);
						}
					}
				}

				if (!valid) {
					return cb('Failed to verify signature in multisignature keysgroup');
				}
			}
		} catch (e) {
			library.logger.error("stack", e.stack);
			return cb('Failed to verify signature in multisignature keysgroup');
		}
	}

	if (trs.asset.multisignature.keysgroup.indexOf('+' + sender.publicKey) !== -1) {
		return cb('Invalid multisignature keysgroup. Can not contain sender');
	}

	async.eachSeries(trs.asset.multisignature.keysgroup, function (key, eachSeriesCb) {
		var math = key[0];
		var publicKey = key.slice(1);

		if (math !== '+') {
			return eachSeriesCb('Invalid math operator in multisignature keysgroup');
		}

		try {
			var b = new Buffer(publicKey, 'hex');
			if (b.length !== 33) {
				return eachSeriesCb('Invalid public key in multisignature keysgroup');
			}
		} catch (e) {
			library.logger.error("stack", e.stack);
			return eachSeriesCb('Invalid public key in multisignature keysgroup');
		}

		return eachSeriesCb();
	}, function (err) {
		if (err) {
			return cb(err);
		}

		var keysgroup = trs.asset.multisignature.keysgroup.reduce(function (p, c) {
			if (p.indexOf(c) < 0) { p.push(c); }
			return p;
		}, []);

		if (keysgroup.length !== trs.asset.multisignature.keysgroup.length) {
			return cb('Encountered duplicate public key in multisignature keysgroup');
		}

		return cb(null, trs);
	});
};

//
//__API__ `process`

//
Multisignature.prototype.process = function (trs, sender, cb) {
	return cb(null, trs);
};

//
//__API__ `getBytes`

//
Multisignature.prototype.getBytes = function (trs, skip) {
	var keysgroupBuffer = new Buffer(trs.asset.multisignature.keysgroup.join(''), 'utf8');

	var bb = new ByteBuffer(1 + 1 + keysgroupBuffer.length, true);
	bb.writeByte(trs.asset.multisignature.min);
	bb.writeByte(trs.asset.multisignature.lifetime);
	for (var i = 0; i < keysgroupBuffer.length; i++) {
		bb.writeByte(keysgroupBuffer[i]);
	}
	bb.flip();

	return bb.toBuffer();
};

//
//__API__ `apply`

//
Multisignature.prototype.apply = function (trs, block, sender, cb) {
	__private.unconfirmedSignatures[sender.address] = false;

	this.scope.account.merge(sender.address, {
		multisignatures: trs.asset.multisignature.keysgroup,
		multimin: trs.asset.multisignature.min,
		multilifetime: trs.asset.multisignature.lifetime,
		blockId: block.id,
		round: modules.rounds.getRoundFromHeight(block.height)
	}, function (err) {
		if (err) {
			return cb(err);
		}

		// Get public keys
		async.eachSeries(trs.asset.multisignature.keysgroup, function (transaction, eachSeriesCb) {
			var key = transaction.substring(1);
			var address = modules.accounts.generateAddressByPublicKey(key);

			// Create accounts
			modules.accounts.setAccountAndGet({
				address: address,
				publicKey: key
			}, function (err) {
				return eachSeriesCb(err);
			});
		}, cb);
	});
};

//
//__API__ `undo`

//
Multisignature.prototype.undo = function (trs, block, sender, cb) {
	var multiInvert = Diff.reverse(trs.asset.multisignature.keysgroup);

	__private.unconfirmedSignatures[sender.address] = true;

	this.scope.account.merge(sender.address, {
		multisignatures: multiInvert,
		multimin: -trs.asset.multisignature.min,
		multilifetime: -trs.asset.multisignature.lifetime,
		blockId: block.id,
		round: modules.rounds.getRoundFromHeight(block.height)
	}, cb);
};

//
//__API__ `applyUnconfirmed`

//
Multisignature.prototype.applyUnconfirmed = function (trs, sender, cb) {
	if (__private.unconfirmedSignatures[sender.address]) {
		return cb('Signature on this account is pending confirmation');
	}

	if (Array.isArray(sender.multisignatures) && sender.multisignatures.length) {
		return cb('Account already has multisignatures enabled');
	}

	__private.unconfirmedSignatures[sender.address] = true;

	this.scope.account.merge(sender.address, {
		u_multisignatures: trs.asset.multisignature.keysgroup,
		u_multimin: trs.asset.multisignature.min,
		u_multilifetime: trs.asset.multisignature.lifetime
	}, cb);
};

//
//__API__ `undoUnconfirmed`

//
Multisignature.prototype.undoUnconfirmed = function (trs, sender, cb) {
	var multiInvert = Diff.reverse(trs.asset.multisignature.keysgroup);

	__private.unconfirmedSignatures[sender.address] = false;

	this.scope.account.merge(sender.address, {
		u_multisignatures: multiInvert,
		u_multimin: -trs.asset.multisignature.min,
		u_multilifetime: -trs.asset.multisignature.lifetime
	}, cb);
};

Multisignature.prototype.schema = {
	id: 'Multisignature',
	type: 'object',
	properties: {
		min: {
			type: 'integer',
			minimum: 1,
			maximum: 15
		},
		keysgroup: {
			type: 'array',
			minLength: 1,
			maxLength: 16
		},
		lifetime: {
			type: 'integer',
			minimum: 1,
			maximum: 72
		}
	},
	required: ['min', 'keysgroup', 'lifetime']
};

//
//__API__ `objectNormalize`

//
Multisignature.prototype.objectNormalize = function (trs) {
	var report = library.schema.validate(trs.asset.multisignature, Multisignature.prototype.schema);

	if (!report) {
		throw 'Failed to validate multisignature schema: ' + this.scope.schema.getLastErrors().map(function (err) {
			return err.message;
		}).join(', ');
	}

	return trs;
};

//
//__API__ `dbRead`

//
Multisignature.prototype.dbRead = function (raw) {
	if (!raw.m_keysgroup) {
		return null;
	} else {
		var multisignature = {
			min: raw.m_min,
			lifetime: raw.m_lifetime,
		};

		if (typeof raw.m_keysgroup === 'string') {
			multisignature.keysgroup = raw.m_keysgroup.split(',');
		} else {
			multisignature.keysgroup = [];
		}

		return {multisignature: multisignature};
	}
};

Multisignature.prototype.dbTable = 'multisignatures';

Multisignature.prototype.dbFields = [
	'min',
	'lifetime',
	'keysgroup',
	'transactionId'
];

//
//__API__ `dbSave`

//
Multisignature.prototype.dbSave = function (trs) {
	return {
		table: this.dbTable,
		fields: this.dbFields,
		values: {
			min: trs.asset.multisignature.min,
			lifetime: trs.asset.multisignature.lifetime,
			keysgroup: trs.asset.multisignature.keysgroup.join(','),
			transactionId: trs.id
		}
	};
};

//
//__API__ `afterSave`

//
Multisignature.prototype.afterSave = function (trs, cb) {
	return cb();
};

//
//__API__ `ready`

//
Multisignature.prototype.ready = function (trs, sender) {


	if (!Array.isArray(trs.signatures)) {
		return false;
	}

	if (!Array.isArray(sender.multisignatures) || !sender.multisignatures.length) {
		return trs.signatures.length === trs.asset.multisignature.keysgroup.length;
	} else {
		return trs.signatures.length >= sender.multimin;
	}
};

// Export
module.exports = Multisignature;
