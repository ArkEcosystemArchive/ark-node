'use strict';

var async = require('async');
var constants = require('../helpers/constants.js');
var crypto = require('crypto');
var MilestoneBlocks = require('../helpers/milestoneBlocks.js');
var Router = require('../helpers/router.js');
var schema = require('../schema/signatures.js');
var slots = require('../helpers/slots.js');
var transactionTypes = require('../helpers/transactionTypes.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.assetTypes = {};

// Constructor
function Signatures (cb, scope) {
	library = scope;
	self = this;

	var Signature = require('../logic/signature.js');
	__private.assetTypes[transactionTypes.SIGNATURE] = library.logic.transaction.attachAssetType(
		transactionTypes.SIGNATURE, new Signature()
	);

	return cb(null, self);
}

// Private methods
__private.attachApi = function () {
	var router = new Router();

	router.use(function (req, res, next) {
		if (modules) { return next(); }
		res.status(500).send({success: false, error: 'Blockchain is loading'});
	});

	router.map(shared, {
		'get /fee': 'getFee',
		'put /': 'addSignature'
	});

	router.use(function (req, res, next) {
		res.status(500).send({success: false, error: 'API endpoint not found'});
	});

	library.network.app.use('/api/signatures', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

// Public methods

// Events
//
//__EVENT__ `onBind`

//
Signatures.prototype.onBind = function (scope) {
	modules = scope;

	__private.assetTypes[transactionTypes.SIGNATURE].bind({
		modules: modules, library: library
	});
};


//
//__EVENT__ `onAttachPublicApi`

//
Signatures.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};

// Shared
shared.getFee = function (req, cb) {
	var fee = null;

	fee = constants.fees.secondsignature;

	return cb(null, {fee: fee});
};

shared.addSignature = function (req, cb) {
	library.schema.validate(req.body, schema.addSignature, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var keypair = library.crypto.makeKeypair(req.body.secret);

		if (req.body.publicKey) {
			if (keypair.publicKey.toString('hex') !== req.body.publicKey) {
				return cb('Invalid passphrase');
			}
		}

		library.balancesSequence.add(function (cb) {
			if (req.body.multisigAccountPublicKey && req.body.multisigAccountPublicKey !== keypair.publicKey.toString('hex')) {
				modules.accounts.getAccount({publicKey: req.body.multisigAccountPublicKey}, function (err, account) {
					if (err) {
						return cb(err);
					}

					if (!account || !account.publicKey) {
						return cb('Multisignature account not found');
					}

					if (!account.multisignatures || !account.multisignatures) {
						return cb('Account does not have multisignatures enabled');
					}

					if (account.multisignatures.indexOf(keypair.publicKey.toString('hex')) < 0) {
						return cb('Account does not belong to multisignature group');
					}

					if (account.secondSignature || account.u_secondSignature) {
						return cb('Account already has a second passphrase');
					}

					modules.accounts.getAccount({publicKey: keypair.publicKey}, function (err, requester) {
						if (err) {
							return cb(err);
						}

						if (!requester || !requester.publicKey) {
							return cb('Requester not found');
						}

						if (requester.secondSignature && !req.body.secondSecret) {
							return cb('Missing requester second passphrase');
						}

						if (requester.publicKey === account.publicKey) {
							return cb('Invalid requester public key');
						}

						var secondKeypair = library.crypto.makeKeypair(req.body.secondSecret);
						var transaction;

						try {
							transaction = library.logic.transaction.create({
								type: transactionTypes.SIGNATURE,
								sender: account,
								keypair: keypair,
								requester: keypair,
								secondKeypair: secondKeypair,

							});
						} catch (e) {
							return cb(e.toString());
						}

						library.bus.message("transactionsReceived", [transaction], "api", cb);
					});
				});
			} else {
				modules.accounts.setAccountAndGet({publicKey: keypair.publicKey.toString('hex')}, function (err, account) {
					if (err) {
						return cb(err);
					}

					if (!account || !account.publicKey) {
						return cb('Account not found');
					}

					if (account.secondSignature || account.u_secondSignature) {
						return cb('Account already has a second passphrase');
					}

					var secondKeypair = library.crypto.makeKeypair(req.body.secondSecret);
					var transaction;

					try {
						transaction = library.logic.transaction.create({
							type: transactionTypes.SIGNATURE,
							sender: account,
							keypair: keypair,
							secondKeypair: secondKeypair
						});
					} catch (e) {
						return cb(e.toString());
					}

					library.bus.message("transactionsReceived", [transaction], "api", cb);
				});
			}

		}, function (err, transaction) {
			if (err) {
				return cb(err);
			}
			return cb(null, {transaction: transaction[0]});
		});

	});
};

// Export
module.exports = Signatures;
