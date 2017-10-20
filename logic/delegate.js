'use strict';

var constants = require('../helpers/constants.js');

// Private fields
var modules, library;

// Constructor
function Delegate () {}

// Public methods
//
//__API__ `bind`

//
Delegate.prototype.bind = function (scope) {
	modules = scope.modules;
	library = scope.library;
};

//
//__API__ `create`

//
Delegate.prototype.create = function (data, trs) {
	trs.recipientId = null;
	trs.amount = 0;
	trs.asset.delegate = {
		username: data.username,
		publicKey: data.sender.publicKey
	};

	if (trs.asset.delegate.username) {
		trs.asset.delegate.username = trs.asset.delegate.username.toLowerCase().trim();
	}

	return trs;
};

//
//__API__ `calculateFee`

//
Delegate.prototype.calculateFee = function (trs) {
	return constants.fees.delegate;
};

//
//__API__ `verify`

//
Delegate.prototype.verify = function (trs, sender, cb) {
	if (trs.recipientId) {
		return cb('Invalid recipient');
	}

	if (trs.amount !== 0) {
		return cb('Invalid transaction amount');
	}

	if (sender.isDelegate) {
		return cb('Account is already a delegate');
	}

	if (!trs.asset || !trs.asset.delegate) {
		return cb('Invalid transaction asset');
	}

	if (!trs.asset.delegate.username) {
		return cb('Username is undefined');
	}

	if (trs.asset.delegate.username !== trs.asset.delegate.username.toLowerCase()) {
		return cb('Username must be lowercase');
	}

	var isAddress = /^[1-9A-Za-z]{1,35}$/g;
	var allowSymbols = /^[a-z0-9!@$&_.]+$/g;

	var username = String(trs.asset.delegate.username).toLowerCase().trim();

	if (username === '') {
		return cb('Empty username');
	}

	if (username.length > 20) {
		return cb('Username is too long. Maximum is 20 characters');
	}

	// Not relevant anymore
	// if (isAddress.test(username)) {
	// 	return cb('Username can not be a potential address');
	// }

	if (!allowSymbols.test(username)) {
		return cb('Username can only contain alphanumeric characters with the exception of !@$&_.');
	}

	modules.accounts.getAccount({
		username: username
	}, function (err, account) {
		if (err) {
			return cb(err);
		}

		if (account) {
			return cb('Username already exists');
		}

		return cb(null, trs);
	});
};

//
//__API__ `process`

//
Delegate.prototype.process = function (trs, sender, cb) {
	return cb(null, trs);
};

//
//__API__ `getBytes`

//
Delegate.prototype.getBytes = function (trs) {
	if (!trs.asset.delegate.username) {
		return null;
	}

	var buf;

	try {
		buf = new Buffer(trs.asset.delegate.username, 'utf8');
	} catch (e) {
		throw e;
	}

	return buf;
};

//
//__API__ `apply`

//
Delegate.prototype.apply = function (trs, block, sender, cb) {
	var data = {
		address: sender.address,
		u_isDelegate: 0,
		isDelegate: 1,
		vote: 0
	};

	if (trs.asset.delegate.username) {
		data.u_username = null;
		data.username = trs.asset.delegate.username;
	}

	modules.accounts.setAccountAndGet(data, cb);
};

//
//__API__ `undo`

//
Delegate.prototype.undo = function (trs, block, sender, cb) {
	var data = {
		address: sender.address,
		u_isDelegate: 1,
		isDelegate: 0,
		vote: 0
	};

	if (!sender.nameexist && trs.asset.delegate.username) {
		data.username = null;
		data.u_username = trs.asset.delegate.username;
	}

	modules.accounts.setAccountAndGet(data, cb);
};

//
//__API__ `applyUnconfirmed`

//
Delegate.prototype.applyUnconfirmed = function (trs, sender, cb) {
	if (sender.u_isDelegate) {
		return cb('Account is already a delegate');
	}

	function done () {
		var data = {
			address: sender.address,
			u_isDelegate: 1,
			isDelegate: 0
		};

		if (trs.asset.delegate.username) {
			data.username = null;
			data.u_username = trs.asset.delegate.username;
		}

		modules.accounts.setAccountAndGet(data, cb);
	}

	modules.accounts.getAccount({
		u_username: trs.asset.delegate.username
	}, function (err, account) {
		if (err) {
			return cb(err);
		}

		if (account) {
			return cb('Username already exists');
		}

		done();
	});
};

//
//__API__ `undoUnconfirmed`

//
Delegate.prototype.undoUnconfirmed = function (trs, sender, cb) {
	var data = {
		address: sender.address,
		u_isDelegate: 0,
		isDelegate: 0
	};

	if (trs.asset.delegate.username) {
		data.username = null;
		data.u_username = null;
	}

	modules.accounts.setAccountAndGet(data, cb);
};

Delegate.prototype.schema = {
	id: 'Delegate',
	type: 'object',
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
Delegate.prototype.objectNormalize = function (trs) {
	var report = library.schema.validate(trs.asset.delegate, Delegate.prototype.schema);

	if (!report) {
		throw 'Failed to validate delegate schema: ' + this.scope.schema.getLastErrors().map(function (err) {
			return err.message;
		}).join(', ');
	}

	return trs;
};

//
//__API__ `dbRead`

//
Delegate.prototype.dbRead = function (raw) {
	if (!raw.d_username) {
		return null;
	} else {
		var delegate = {
			username: raw.d_username,
			publicKey: raw.t_senderPublicKey,
			address: raw.t_senderId
		};

		return {delegate: delegate};
	}
};

Delegate.prototype.dbTable = 'delegates';

Delegate.prototype.dbFields = [
	'username',
	'transactionId'
];

//
//__API__ `dbSave`

//
Delegate.prototype.dbSave = function (trs) {
	return {
		table: this.dbTable,
		fields: this.dbFields,
		values: {
			username: trs.asset.delegate.username,
			transactionId: trs.id
		}
	};
};

//
//__API__ `ready`

//
Delegate.prototype.ready = function (trs, sender) {
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
module.exports = Delegate;
