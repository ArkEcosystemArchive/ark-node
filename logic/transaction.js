'use strict';

var _ = require('lodash');
var bs58check = require('bs58check');
var bignum = require('../helpers/bignum.js');
var ByteBuffer = require('bytebuffer');
var constants = require('../helpers/constants.js');
var crypto = require('crypto');
var bs58check = require('bs58check');
var exceptions = require('../helpers/exceptions.js');
var slots = require('../helpers/slots.js');
var sql = require('../sql/transactions.js');

// Private fields
var self, __private = {}, genesisblock = null;

__private.types = {};

// Constructor
function Transaction (scope, cb) {
	this.scope = scope;
	genesisblock = this.scope.genesisblock;
	self = this;
	cb && cb(null, this);
}

// Private methods
function calc (height) {
	return Math.floor(height / slots.delegates) + (height % slots.delegates > 0 ? 1 : 0);
}

// Public methods
//
//__API__ `create`

//
Transaction.prototype.create = function (data) {
	if (!__private.types[data.type]) {
		throw 'Unknown transaction type ' + data.type;
	}

	if (!data.sender) {
		throw 'Invalid sender';
	}

	if (!data.keypair) {
		throw 'Invalid keypair';
	}

	var trs = {
		type: data.type,
		amount: 0,
		senderPublicKey: data.sender.publicKey,
		requesterPublicKey: data.requester ? data.requester.publicKey.toString('hex') : null,
		timestamp: slots.getTime(),
		vendorField: data.vendorField,
		asset: {}
	};

	trs = __private.types[trs.type].create.call(this, data, trs);
	trs.fee = __private.types[trs.type].calculateFee.call(this, trs, data.sender);
	trs.signature = this.sign(data.keypair, trs);

	if (data.sender.secondSignature && data.secondKeypair) {
		trs.signSignature = this.sign(data.secondKeypair, trs);
	}

	trs.id = this.getId(trs);

	return trs;
};

//
//__API__ `validateAddress`

//
Transaction.prototype.validateAddress = function(address){
	try {
		var decode = bs58check.decode(address);
		return decode[0] == this.scope.crypto.network.pubKeyHash;
	} catch(e){
		return false;
	}
}

//
//__API__ `attachAssetType`

//
Transaction.prototype.attachAssetType = function (typeId, instance) {
	if (instance && typeof instance.create === 'function' && typeof instance.getBytes === 'function' &&
		typeof instance.calculateFee === 'function' && typeof instance.verify === 'function' &&
		typeof instance.objectNormalize === 'function' && typeof instance.dbRead === 'function' &&
		typeof instance.apply === 'function' && typeof instance.undo === 'function' &&
		typeof instance.applyUnconfirmed === 'function' && typeof instance.undoUnconfirmed === 'function' &&
		typeof instance.ready === 'function' && typeof instance.process === 'function'
	) {
		__private.types[typeId] = instance;
		return instance;
	} else {
		throw 'Invalid instance interface';
	}
};

//
//__API__ `sign`

//
Transaction.prototype.sign = function (keypair, trs) {
	var sign = this.scope.crypto.sign(this.getHash(trs), keypair).toString('hex');
	return sign;
};

//
//__API__ `multisign`

//
Transaction.prototype.multisign = function (keypair, trs) {
	var bytes = this.getBytes(trs, true, true);
	var hash = crypto.createHash('sha256').update(bytes).digest();
	var sign = this.scope.crypto.sign(hash, keypair).toString('hex');
	return sign;
};

//
//__API__ `getId`

//
Transaction.prototype.getId = function (trs) {
	return this.getHash(trs).toString('hex');
};

//
//__API__ `getHash`

//
Transaction.prototype.getHash = function (trs) {
	return crypto.createHash('sha256').update(this.getBytes(trs)).digest();
};

// TODO: unfinished
//
//__API__ `fromBytes`

//
Transaction.prototype.fromBytes = function(buffer){
	var tx = {};
	tx.type = buffer.readByte();
	tx.timestamp = buffer.readInt();
	return tx;
}



//
//__API__ `getBytes`

//
Transaction.prototype.getBytes = function (trs, skipSignature, skipSecondSignature) {
	if (!__private.types[trs.type]) {
		throw 'Unknown transaction type ' + trs.type;
	}

	var bb;

	try {
		var assetBytes = __private.types[trs.type].getBytes.call(this, trs, skipSignature, skipSecondSignature);
		var assetSize = assetBytes ? assetBytes.length : 0;
		var i;

		bb = new ByteBuffer(1 + 4 + 32 + 8 + 21 + 64 + 64 + 64 + assetSize, true);
		bb.writeByte(trs.type);
		bb.writeInt(trs.timestamp);

		var senderPublicKeyBuffer = new Buffer(trs.senderPublicKey, 'hex');
		for (i = 0; i < senderPublicKeyBuffer.length; i++) {
			bb.writeByte(senderPublicKeyBuffer[i]);
		}

		if (trs.requesterPublicKey) {
			var requesterPublicKey = new Buffer(trs.requesterPublicKey, 'hex');
			for (i = 0; i < requesterPublicKey.length; i++) {
				bb.writeByte(requesterPublicKey[i]);
			}
		}

		if (trs.recipientId) {
			var recipient = bs58check.decode(trs.recipientId);

			for (i = 0; i < recipient.length; i++) {
				bb.writeByte(recipient[i]);
			}
		} else {
			for (i = 0; i < 21; i++) {
				bb.writeByte(0);
			}
		}

		if (trs.vendorField) {
			var vf = new Buffer(trs.vendorField);
			var fillstart=vf.length;
			for (i = 0; i < fillstart; i++) {
				bb.writeByte(vf[i]);
			}
			for (i = fillstart; i < 64; i++) {
				bb.writeByte(0);
			}
		} else {
			for (i = 0; i < 64; i++) {
				bb.writeByte(0);
			}
		}

		bb.writeLong(trs.amount);
		bb.writeLong(trs.fee);

		if (assetSize > 0) {
			for (i = 0; i < assetSize; i++) {
				bb.writeByte(assetBytes[i]);
			}
		}

		if (!skipSignature && trs.signature) {
			var signatureBuffer = new Buffer(trs.signature, 'hex');
			for (i = 0; i < signatureBuffer.length; i++) {
				bb.writeByte(signatureBuffer[i]);
			}
		}

		if (!skipSecondSignature && trs.signSignature) {
			var signSignatureBuffer = new Buffer(trs.signSignature, 'hex');
			for (i = 0; i < signSignatureBuffer.length; i++) {
				bb.writeByte(signSignatureBuffer[i]);
			}
		}

		bb.flip();
	} catch (e) {
		throw e;
	}

	return bb.toBuffer();
};

//
//__API__ `ready`

//
Transaction.prototype.ready = function (trs, sender) {
	if (!__private.types[trs.type]) {
		throw 'Unknown transaction type :' + trs.type;
	}

	if (!sender) {
		throw 'Unknown sender :' + sender;
	}

	return __private.types[trs.type].ready.call(this, trs, sender);
};


//
//__API__ `countById`

//
Transaction.prototype.countById = function (trs, cb) {
	this.scope.db.one(sql.countById, { id: trs.id }).then(function (row) {
		return cb(null, row.count);
	}).catch(function (err) {
		this.scope.logger.error(err.stack);
		return cb('Transaction#countById error');
	});
};

//
//__API__ `checkConfirmed`

//
Transaction.prototype.checkConfirmed = function (trs, cb) {
	this.countById(trs, function (err, count) {
		if (err) {
			return cb(err);
		} else if (count > 0) {
			return cb('Transaction is already confirmed: ' + trs.id);
		} else {
			return cb(null, trs);
		}
	});
};

//
//__API__ `checkBalance`

//
Transaction.prototype.checkBalance = function (amount, balance, trs, sender) {
	var exceededBalance = bignum(sender[balance].toString()).lessThan(amount);
	var exceeded = (trs.blockId !== genesisblock.block.id && exceededBalance);

	if(exceptions.balance.indexOf(trs.id) > -1){
		exceeded = false;
	}

	return {
		exceeded: exceeded,
		error: exceeded ? [
			'Account does not have enough ARK:', sender.address,
			'balance:', bignum(sender[balance].toString() || '0').div(Math.pow(10,8))
		].join(' ') : null
	};
};

//
//__API__ `process`

//
Transaction.prototype.process = function (trs, sender, requester, cb) {
	if (typeof requester === 'function') {
		cb = requester;
	}

	// // Check transaction type
	// if (!__private.types[trs.type]) {
	// 	return cb('Unknown transaction type ' + trs.type);
	// }
	//
	// // if (!this.ready(trs, sender)) {
	// // 	return cb('Transaction is not ready: ' + trs.id);
	// // }
	//
	// // Get transaction id
	// var txId;
	//
	// try {
	// 	txId = this.getId(trs);
	// } catch (e) {
	// 	this.scope.logger.error(e.stack);
	// 	return cb('Failed to get transaction id');
	// }
	//
	// // Check transaction id
	// if (trs.id && trs.id !== txId) {
	// 	return cb('Invalid transaction id');
	// } else {
	// 	trs.id = txId;
	// }
	//
	// // Check sender
	// if (!sender) {
	// 	return cb('Missing sender');
	// }
	//
	// // Equalize sender address
	// trs.senderId = sender.address;
	//
	// // Check requester public key
	// if (trs.requesterPublicKey) {
	// 	if (sender.multisignatures.indexOf(trs.requesterPublicKey) < 0) {
	// 		return cb('Invalid requester public key');
	// 	}
	// }
	//
	// // Verify signature
	// if (!this.verifySignature(trs, (trs.requesterPublicKey || trs.senderPublicKey), trs.signature)) {
	// 	return cb('Failed to verify signature');
	// }

	// Call process on transaction type
	__private.types[trs.type].process.call(this, trs, sender, function (err, trs) {
		if (err) {
			return cb(err);
		}

		// Check for already confirmed transaction
		this.scope.db.one(sql.countById, { id: trs.id }).then(function (row) {
			if (row.count > 0) {
				return cb('Transaction is already confirmed: ' + trs.id, trs, true);
			}

			return cb(null, trs);
		}).catch(function (err) {
			this.scope.logger.error(err.stack);
			return cb('Transaction#process error');
		});
	}.bind(this));
};

//
//__API__ `verify`

//
Transaction.prototype.verify = function (trs, sender, requester, cb) {
	var valid = false;
	var err = null;
	const INT_32_MIN = -2147483648;
	const INT_32_MAX = 2147483647;

	if (typeof requester === 'function') {
		cb = requester;
	}

	// Get transaction id
	var txId;

	try {
		txId = this.getId(trs);
	} catch (e) {
		this.scope.logger.error(e.stack);
		return cb('Failed to get transaction id');
	}

	// Check transaction id
	if (trs.id !== txId) {
		return cb('Invalid transaction id');
	}

	// Check sender
	if (!sender) {
		return cb('Missing sender');
	}

	// Check transaction type
	if (!__private.types[trs.type]) {
		return cb('Unknown transaction type ' + trs.type);
	}

	// Check for missing sender second signature
	if (!trs.requesterPublicKey && sender.secondSignature && !trs.signSignature && trs.blockId !== genesisblock.block.id) {
		return cb('Missing sender second signature');
	}

	// If second signature provided, check if sender has one enabled
	if (!trs.requesterPublicKey && !sender.secondSignature && (trs.signSignature && trs.signSignature.length > 0)) {
		return cb('Sender does not have a second signature');
	}

	// Check for missing requester second signature
	if (trs.requesterPublicKey && requester.secondSignature && !trs.signSignature) {
		return cb('Missing requester second signature');
	}

	// If second signature provided, check if requester has one enabled
	if (trs.requesterPublicKey && !requester.secondSignature && (trs.signSignature && trs.signSignature.length > 0)) {
		return cb('Requester does not have a second signature');
	}

	// Check sender public key
	if (sender.publicKey && sender.publicKey !== trs.senderPublicKey) {
		err = ['Invalid sender public key:', trs.senderPublicKey, 'expected:', sender.publicKey].join(' ');

		if (exceptions.senderPublicKey.indexOf(trs.id) > -1) {
			this.scope.logger.debug(err);
			this.scope.logger.debug(JSON.stringify(trs));
		} else {
			return cb(err);
		}
	}

	// Check sender address
	// Equalize sender address
	if(!trs.senderId){
		trs.senderId = sender.address;
	}
	if (trs.senderId !== sender.address) {
		return cb('Invalid sender address');
	}

	if(trs.recipientId && !self.validateAddress(trs.recipientId)) {
		return cb('Invalid recipient address');
	}

	// Determine multisignatures from sender or transaction asset
	var multisignatures = sender.multisignatures || sender.u_multisignatures || [];
	if (multisignatures.length === 0) {
		if (trs.asset && trs.asset.multisignature && trs.asset.multisignature.keysgroup) {

			multisignatures = trs.asset.multisignature.keysgroup.map(function (key) {
				return key.slice(1);
			});
		}
	}

	// Check requester public key
	if (trs.requesterPublicKey) {
		multisignatures.push(trs.senderPublicKey);

		if (sender.multisignatures.indexOf(trs.requesterPublicKey) < 0) {
			return cb('Account does not belong to multisignature group');
		}
	}

	// Verify signature
	try {
		valid = false;
		valid = this.verifySignature(trs, (trs.requesterPublicKey || trs.senderPublicKey), trs.signature);
	} catch (e) {
		this.scope.logger.error(e.stack);
		return cb(e.toString());
	}

	if (!valid) {
		err = 'Failed to verify signature';

		if (exceptions.signatures.indexOf(trs.id) > -1) {
			this.scope.logger.debug(err);
			this.scope.logger.debug(JSON.stringify(trs));
			valid = true;
			err = null;
		} else {
			return cb(err);
		}
	}

	// Verify second signature
	if (requester.secondSignature || sender.secondSignature) {
		try {
			valid = false;
			valid = this.verifySecondSignature(trs, (requester.secondPublicKey || sender.secondPublicKey), trs.signSignature);
		} catch (e) {
			return cb(e.toString());
		}

		if (!valid) {
			return cb('Failed to verify second signature');
		}
	}

	// Check that signatures are unique
	if (trs.signatures && trs.signatures.length) {
		var signatures = trs.signatures.reduce(function (p, c) {
			if (p.indexOf(c) < 0) { p.push(c); }
			return p;
		}, []);

		if (signatures.length !== trs.signatures.length) {
			return cb('Encountered duplicate signature in transaction');
		}
	}

	// Verify multisignatures
	if (trs.signatures) {
		for (var d = 0; d < trs.signatures.length; d++) {
			valid = false;

			for (var s = 0; s < multisignatures.length; s++) {
				if (trs.requesterPublicKey && multisignatures[s] === trs.requesterPublicKey) {
					continue;
				}

				if (this.verifySignature(trs, multisignatures[s], trs.signatures[d])) {
					valid = true;
				}
			}

			if (!valid) {
				return cb('Failed to verify multisignature');
			}
		}
	}

	// Check amount
	if (trs.amount < 0 || trs.amount > constants.totalAmount || String(trs.amount).indexOf('.') >= 0 || trs.amount.toString().indexOf('e') >= 0) {
		return cb('Invalid transaction amount');
	}

	// Check confirmed sender balance
	var amount = bignum(trs.amount.toString()).plus(trs.fee.toString());
	var senderBalance = this.checkBalance(amount, 'balance', trs, sender);

	if (senderBalance.error) {
		return cb(senderBalance.error);
	}

	if (trs.timestamp < INT_32_MIN || trs.timestamp > INT_32_MAX) {
		return cb('Invalid transaction timestamp. Timestamp is not in the int32 range');
	}

	// Check timestamp
	if (slots.getSlotNumber(trs.timestamp) > slots.getSlotNumber()) {
		return cb('Invalid transaction timestamp. Timestamp is in the future');
	}

	// Check fee
	if(!trs.fee || trs.fee < 1) {
		return cb('Invalid transaction fee');
	}

	// Call verify on transaction type
	__private.types[trs.type].verify.call(this, trs, sender, function (err) {
		if (err) {
			return cb(err);
		} else {
			// Check for already confirmed transaction
			return self.checkConfirmed(trs, cb);
		}
	});
};


//
//__API__ `verifyFee`

//
Transaction.prototype.verifyFee = function (trs) {
  // Calculate fee
	if(!trs.fee || trs.fee < 1) {
		return false;
	}

	var fee = __private.types[trs.type].calculateFee.call(this, trs);

	if (!fee || trs.fee < fee) {
		return false;
	}

	else {
		return true;
	}
}

//
//__API__ `verifySignature`

//
Transaction.prototype.verifySignature = function (trs, publicKey, signature) {
	if (!__private.types[trs.type]) {
		throw 'Unknown transaction type ' + trs.type;
	}

	if (!signature) { return false; }

	var res;

	try {
		var bytes = this.getBytes(trs, true, true);
		res = this.verifyBytes(bytes, publicKey, signature);
	} catch (e) {
		throw e;
	}

	return res;
};

//
//__API__ `verifySecondSignature`

//
Transaction.prototype.verifySecondSignature = function (trs, publicKey, signature) {
	if (!__private.types[trs.type]) {
		throw 'Unknown transaction type ' + trs.type;
	}

	if (!signature) { return false; }

	var res;

	try {
		var bytes = this.getBytes(trs, false, true);
		res = this.verifyBytes(bytes, publicKey, signature);
	} catch (e) {
		throw e;
	}

	return res;
};

//
//__API__ `verifyBytes`

//
Transaction.prototype.verifyBytes = function (bytes, publicKey, signature) {
	var res;

	try {
		var data2 = new Buffer(bytes.length);

		for (var i = 0; i < data2.length; i++) {
			data2[i] = bytes[i];
		}

		var hash = crypto.createHash('sha256').update(data2).digest();
		var signatureBuffer = new Buffer(signature, 'hex');
		var publicKeyBuffer = new Buffer(publicKey, 'hex');

		res = this.scope.crypto.verify(hash, signatureBuffer || ' ', publicKeyBuffer || ' ');
	} catch (e) {
		throw e;
	}

	return res;
};

//
//__API__ `apply`

//
Transaction.prototype.apply = function (trs, block, sender, cb) {
	if (!this.ready(trs, sender)) {
		return cb('Transaction is not ready');
	}

	// Check confirmed sender balance
	var amount = bignum(trs.amount.toString()).plus(trs.fee.toString());
	var senderBalance = this.checkBalance(amount, 'balance', trs, sender);

	if (senderBalance.error) {
		return cb(senderBalance.error);
	}

	amount = amount.toNumber();

	this.scope.account.merge(sender.address, {
		balance: -amount,
		blockId: block.id,
		round: calc(block.height)
	}, function (err, sender) {
		if (err) {
			return cb(err);
		}

		__private.types[trs.type].apply.call(this, trs, block, sender, function (err) {
			if (err) {
				this.scope.account.merge(sender.address, {
					balance: amount,
					blockId: block.id,
					round: calc(block.height)
				}, function (err) {
					return cb(err);
				});
			} else {
				return cb();
			}
		}.bind(this));
	}.bind(this));
};

//
//__API__ `undo`

//
Transaction.prototype.undo = function (trs, block, sender, cb) {
	var amount = bignum(trs.amount.toString());
	    amount = amount.plus(trs.fee.toString()).toNumber();

	this.scope.account.merge(sender.address, {
		balance: amount,
		blockId: block.id,
		round: calc(block.height)
	}, function (err, sender) {
		if (err) {
			return cb(err);
		}

		__private.types[trs.type].undo.call(this, trs, block, sender, function (err) {
			if (err) {
				this.scope.account.merge(sender.address, {
					balance: amount,
					blockId: block.id,
					round: calc(block.height)
				}, function (err) {
					return cb(err);
				});
			} else {
				return cb();
			}
		}.bind(this));
	}.bind(this));
};

//
//__API__ `applyUnconfirmed`

//
Transaction.prototype.applyUnconfirmed = function (trs, sender, requester, cb) {
	if (typeof requester === 'function') {
		cb = requester;
	}

	// Check unconfirmed sender balance
	var amount = bignum(trs.amount.toString()).plus(trs.fee.toString());
	var senderBalance = this.checkBalance(amount, 'u_balance', trs, sender);

	if (senderBalance.error) {
		return cb(senderBalance.error);
	}

	amount = amount.toNumber();

	this.scope.account.merge(sender.address, {u_balance: -amount}, function (err, sender) {
		if (err) {
			return cb(err);
		}

		__private.types[trs.type].applyUnconfirmed.call(this, trs, sender, function (err) {
			if (err) {
				this.scope.account.merge(sender.address, {u_balance: amount}, function (err2) {
					return cb(err2 || err);
				});
			} else {
				return cb();
			}
		}.bind(this));
	}.bind(this));
};

//
//__API__ `undoUnconfirmed`

//
Transaction.prototype.undoUnconfirmed = function (trs, sender, cb) {
	var amount = bignum(trs.amount.toString());
	    amount = amount.plus(trs.fee.toString()).toNumber();

	this.scope.account.merge(sender.address, {u_balance: amount}, function (err, sender) {
		if (err) {
			return cb(err);
		}

		__private.types[trs.type].undoUnconfirmed.call(this, trs, sender, function (err) {
			if (err) {
				this.scope.account.merge(sender.address, {u_balance: -amount}, function (err2) {
					return cb(err2 || err);
				});
			} else {
				return cb();
			}
		}.bind(this));
	}.bind(this));
};

Transaction.prototype.dbTable = 'transactions';

Transaction.prototype.dbFields = [
	'id',
	'blockId',
	'type',
	'timestamp',
	'senderPublicKey',
	'requesterPublicKey',
	'vendorField',
	'senderId',
	'recipientId',
	'amount',
	'fee',
	'signature',
	'signSignature',
	'signatures',
	'rawasset'
];

//
//__API__ `dbSave`

//
Transaction.prototype.dbSave = function (trs) {
	if (!__private.types[trs.type]) {
		throw 'Unknown transaction type ' + trs.type;
	}

	var senderPublicKey, signature, signSignature, requesterPublicKey, vendorField;

	try {
		senderPublicKey = new Buffer(trs.senderPublicKey, 'hex');
		signature = new Buffer(trs.signature, 'hex');
		signSignature = trs.signSignature ? new Buffer(trs.signSignature, 'hex') : null;
		vendorField = trs.vendorField;
		requesterPublicKey = trs.requesterPublicKey ? new Buffer(trs.requesterPublicKey, 'hex') : null;
	} catch (e) {
		throw e;
	}

	var promises = [
		{
			table: this.dbTable,
			fields: this.dbFields,
			values: {
				id: trs.id,
				blockId: trs.blockId,
				type: trs.type,
				timestamp: trs.timestamp,
				senderPublicKey: senderPublicKey,
				requesterPublicKey: requesterPublicKey,
				vendorField: vendorField,
				senderId: trs.senderId,
				recipientId: trs.recipientId || null,
				amount: trs.amount,
				fee: trs.fee,
				signature: signature,
				signSignature: signSignature,
				signatures: trs.signatures ? JSON.stringify(trs.signatures) : null,
				rawasset: JSON.stringify(trs.asset)
			}
		}
	];

	var promise = __private.types[trs.type].dbSave(trs);

	if (promise) {
		promises.push(promise);
	}

	return promises;
};

//
//__API__ `afterSave`

//
Transaction.prototype.afterSave = function (trs, cb) {
	var tx_type = __private.types[trs.type];

	if (!tx_type) {
		return cb('Unknown transaction type ' + trs.type);
	} else {
		if (typeof tx_type.afterSave === 'function') {
			return tx_type.afterSave.call(this, trs, cb);
		} else {
			return cb(null, trs);
		}
	}
};

var txschema =  {
	id: 'Transaction',
	type: 'object',
	properties: {
		id: {
			type: 'string'
		},
		height: {
			type: 'integer'
		},
		blockId: {
			type: 'string'
		},
		blockid: {
			type: 'string'
		},
		confirmations: {
			type: 'integer'
		},
		type: {
			type: 'integer'
		},
		timestamp: {
			type: 'integer'
		},
		senderPublicKey: {
			type: 'string',
			format: 'publicKey'
		},
		requesterPublicKey: {
			type: 'string',
			format: 'publicKey'
		},
		vendorField: {
			type: 'string',
			format: 'vendorField'
		},
		senderId: {
			type: 'string'
		},
		recipientId: {
			type: 'string'
		},
		amount: {
			type: 'integer',
			minimum: 0,
			maximum: constants.totalAmount
		},
		fee: {
			type: 'integer',
			minimum: 0,
			maximum: constants.totalAmount
		},
		signature: {
			type: 'string',
			format: 'signature'
		},
		signSignature: {
			type: 'string',
			format: 'signature'
		},
		asset: {
			type: 'object'
		},
		hop: {
			type: 'integer',
			minimum: 0
		}
	},
	required: ['type', 'timestamp', 'senderPublicKey', 'signature']
};

Transaction.prototype.schema = txschema;

//
//__API__ `objectNormalize`

//
Transaction.prototype.objectNormalize = function (trs) {
	if (!__private.types[trs.type]) {
		throw 'Unknown transaction type ' + trs.type;
	}

	for (var i in trs) {
		if (!txschema.properties[i] || trs[i] === null || typeof trs[i] === 'undefined') {
			delete trs[i];
		}
	}

	if(!trs.hop || trs.hop < 0) trs.hop = 4;

	var report = this.scope.schema.validate(trs, txschema);
	if (!report) {
		var log=this.scope.logger;
		throw 'Failed to validate transaction schema: ' + this.scope.schema.getLastErrors().map(function (err) {
			log.error("details",err);
			return err.message;
		}).join(', ');
	}

	try {
		trs = __private.types[trs.type].objectNormalize.call(this, trs);
	} catch (e) {
		throw e;
	}

	return trs;
};

//
//__API__ `dbRead`

//
Transaction.prototype.dbRead = function (raw) {
	var tx = raw;

	tx.amount=parseInt(raw.amount);
	tx.fee=parseInt(raw.fee);

	// if (!__private.types[tx.type]) {
	// 	throw 'Unknown transaction type ' + tx.type;
	// }
	//
	// var asset = __private.types[tx.type].dbRead.call(this, raw);
	//
	// if (asset) {
	// 	tx.asset = _.extend(tx.asset, asset);
	// }

	return self.objectNormalize(tx);
};

// Export
module.exports = Transaction;
