'use strict';

var constants = require('../helpers/constants.js');

// Private fields
var modules, library;

// Constructor
function Transfer () {}

// Public methods
//
//__API__ `bind`

//
Transfer.prototype.bind = function (scope) {
	modules = scope.modules;
	library = scope.library;
};

//
//__API__ `create`

//
Transfer.prototype.create = function (data, trs) {
	trs.recipientId = data.recipientId;
	trs.amount = data.amount;

	return trs;
};

//
//__API__ `calculateFee`

//
Transfer.prototype.calculateFee = function (trs) {
	return constants.fees.send;
};

//
//__API__ `verify`

//
Transfer.prototype.verify = function (trs, sender, cb) {
	var isAddress = /^[1-9A-Za-z]{1,35}$/g;
	if (!trs.recipientId || !isAddress.test(trs.recipientId)) {
		return cb('Invalid recipient');
	}

	if (trs.amount <= 0) {
		return cb('Invalid transaction amount');
	}

	return cb(null, trs);
};

//
//__API__ `process`

//
Transfer.prototype.process = function (trs, sender, cb) {
	return cb(null, trs);
};

//
//__API__ `getBytes`

//
Transfer.prototype.getBytes = function (trs) {
	return null;
};

//
//__API__ `apply`

//
Transfer.prototype.apply = function (trs, block, sender, cb) {
	modules.accounts.setAccountAndGet({address: trs.recipientId}, function (err, recipient) {
		if (err) {
			return cb(err);
		}

		modules.accounts.mergeAccountAndGet({
			address: trs.recipientId,
			balance: trs.amount,
			u_balance: trs.amount,
			blockId: block.id,
			round: modules.rounds.getRoundFromHeight(block.height)
		}, cb);
	});
};

//
//__API__ `undo`

//
Transfer.prototype.undo = function (trs, block, sender, cb) {
	modules.accounts.setAccountAndGet({address: trs.recipientId}, function (err, recipient) {
		if (err) {
			return cb(err);
		}

		modules.accounts.mergeAccountAndGet({
			address: trs.recipientId,
			balance: -trs.amount,
			u_balance: -trs.amount,
			blockId: block.id,
			round: modules.rounds.getRoundFromHeight(block.height)
		}, cb);
	});
};

//
//__API__ `applyUnconfirmed`

//
Transfer.prototype.applyUnconfirmed = function (trs, sender, cb) {
	return cb(null, trs);
};

//
//__API__ `undoUnconfirmed`

//
Transfer.prototype.undoUnconfirmed = function (trs, sender, cb) {
	return cb(null, trs);
};

//
//__API__ `objectNormalize`

//
Transfer.prototype.objectNormalize = function (trs) {
	delete trs.blockId;
	return trs;
};

//
//__API__ `dbRead`

//
Transfer.prototype.dbRead = function (raw) {
	return null;
};

//
//__API__ `dbSave`

//
Transfer.prototype.dbSave = function (trs) {
	return null;
};

//
//__API__ `ready`

//
Transfer.prototype.ready = function (trs, sender) {
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
module.exports = Transfer;
