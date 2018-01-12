'use strict';

var bignum = require('../helpers/bignum.js');
var BlockReward = require('../logic/blockReward.js');
var constants = require('../helpers/constants.js');
var crypto = require('crypto');
var arkjs = require('arkjs');
var extend = require('extend');
var Router = require('../helpers/router.js');
var schema = require('../schema/accounts.js');
var slots = require('../helpers/slots.js');
var transactionTypes = require('../helpers/transactionTypes.js');

// Private fields
var modules, library, self, __private = {}, shared = {};

__private.assetTypes = {};
__private.blockReward = new BlockReward();

// Constructor
function Accounts (cb, scope) {
	library = scope;
	self = this;

	var Vote = require('../logic/vote.js');
	__private.assetTypes[transactionTypes.VOTE] = library.logic.transaction.attachAssetType(
		transactionTypes.VOTE, new Vote()
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
		'get /getBalance': 'getBalance',
		'get /getPublicKey': 'getPublickey',
		'get /delegates': 'getDelegates',
		'get /delegates/fee': 'getDelegatesFee',
		'put /delegates': 'addDelegates',
		'get /': 'getAccount'
	});

	if (process.env.DEBUG && process.env.DEBUG.toUpperCase() === 'TRUE') {
		router.get('/getAllAccounts', function (req, res) {
			return res.json({success: true, accounts: __private.accounts});
		});
	}

	router.get('/top', function (req, res, next) {
		req.sanitize(req.query, schema.top, function (err, report, query) {
			if (err) { return next(err); }
			if (!report.isValid) { return res.json({success: false, error: report.issues}); }

			self.getAccounts({
				sort: {
					balance: -1
				},
				offset: query.offset,
				limit: (query.limit || 100)
			}, function (err, raw) {
				if (err) {
					return res.json({success: false, error: err});
				}

				var accounts = raw.map(function (account) {
					return {
						address: account.address,
						balance: account.balance,
						publicKey: account.publicKey
					};
				});

				res.json({success: true, accounts: accounts});
			});
		});
	});

	router.get('/count', function (req, res) {
		return res.json({success: true, count: Object.keys(__private.accounts).length});
	});

	router.use(function (req, res, next) {
		res.status(500).send({success: false, error: 'API endpoint was not found'});
	});

	library.network.app.use('/api/accounts', router);
	library.network.app.use(function (err, req, res, next) {
		if (!err) { return next(); }
		library.logger.error('API error ' + req.url, err);
		res.status(500).send({success: false, error: 'API error: ' + err.message});
	});
};

// Public methods
//
//__API__ `generateAddressByPublicKey`

//
Accounts.prototype.generateAddressByPublicKey = function (publicKey) {
	return arkjs.crypto.getAddress(publicKey, library.config.network.pubKeyHash);
};

//
//__API__ `getAccount`

//
Accounts.prototype.getAccount = function (filter, fields, cb) {
	if (filter.publicKey) {
		filter.address = self.generateAddressByPublicKey(filter.publicKey);
		delete filter.publicKey;
	}

	library.logic.account.get(filter, fields, cb);
};

//
//__API__ `getAccounts`

//
Accounts.prototype.getAccounts = function (filter, fields, cb) {
	library.logic.account.getAll(filter, fields, cb);
};

//
//__API__ `setAccountAndGet`

//
Accounts.prototype.setAccountAndGet = function (data, cb) {
	var address = data.address || null;

	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return cb('Missing address or public key');
		}
	}

	if (!address) {
		return cb('Invalid public key');
	}

	library.logic.account.set(address, data, function (err) {
		if (err) {
			return cb(err);
		}
		return library.logic.account.get({address: address}, cb);
	});
};

//
//__API__ `mergeAccountAndGet`

//
Accounts.prototype.mergeAccountAndGet = function (data, cb) {
	var address = data.address || null;

	if (address === null) {
		if (data.publicKey) {
			address = self.generateAddressByPublicKey(data.publicKey);
		} else {
			return cb('Missing address or public key');
		}
	}

	if (!address) {
		return cb('Invalid public key');
	}

	return library.logic.account.merge(address, data, cb);
};

// Events
//
//__EVENT__ `onBind`

//
Accounts.prototype.onBind = function (scope) {
	modules = scope;

	__private.assetTypes[transactionTypes.VOTE].bind({
		modules: modules, library: library
	});
};

//
//__EVENT__ `onAttachPublicApi`

//
Accounts.prototype.onAttachPublicApi = function () {
 	__private.attachApi();
};



shared.getBalance = function (req, cb) {
	library.schema.validate(req.body, schema.getBalance, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var isAddress = /^[1-9A-Za-z]{1,35}$/g;
		if (!isAddress.test(req.body.address)) {
			return cb('Invalid address');
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return cb(err);
			}

			var balance = account ? account.balance : '0';
			var unconfirmedBalance = account ? account.u_balance : '0';

			return cb(null, {balance: balance, unconfirmedBalance: unconfirmedBalance});
		});
	});
};

shared.getPublickey = function (req, cb) {
	library.schema.validate(req.body, schema.getPublicKey, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var isAddress = /^[1-9A-Za-z]{1,35}$/g;
		if (!isAddress.test(req.body.address)) {
			return cb('Invalid address');
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return cb(err);
			}

			if (!account || !account.publicKey) {
				return cb('Account not found');
			}

			return cb(null, {publicKey: account.publicKey});
		});
	});
};

shared.getDelegates = function (req, cb) {
	library.schema.validate(req.body, schema.getDelegates, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return cb(err);
			}

			if (!account) {
				return cb('Account not found');
			}

			if (account.delegates) {
				modules.delegates.getDelegates(req.body, function (err, res) {
					var delegates = res.delegates.filter(function (delegate) {
						return account.delegates.indexOf(delegate.publicKey) !== -1;
					});

					return cb(null, {delegates: delegates});
				});
			} else {
				return cb(null, {delegates: []});
			}
		});
	});
};

shared.getDelegatesFee = function (req, cb) {
	return cb(null, {fee: constants.fees.delegate});
};

shared.addDelegates = function (req, cb) {
	library.schema.validate(req.body, schema.addDelegates, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var keypair = library.crypto.makeKeypair(req.body.secret);

		if (req.body.publicKey) {
			if (keypair.publicKey.toString('hex') !== req.body.publicKey) {
				return cb('Invalid passphrase');
			}
		}

			if (req.body.multisigAccountPublicKey && req.body.multisigAccountPublicKey !== keypair.publicKey.toString('hex')) {
				modules.accounts.getAccount({ publicKey: req.body.multisigAccountPublicKey }, function (err, account) {
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

					modules.accounts.getAccount({ publicKey: keypair.publicKey }, function (err, requester) {
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

						var secondKeypair = null;

						if (requester.secondSignature) {
							secondKeypair = library.crypto.makeKeypair(req.body.secondSecret);
						}

						var transaction;

						try {
							transaction = library.logic.transaction.create({
								type: transactionTypes.VOTE,
								votes: req.body.delegates,
								sender: account,
								keypair: keypair,
								secondKeypair: secondKeypair,
								requester: keypair
							});
						} catch (e) {
							return cb(e.toString());
						}

						library.bus.message("transactionsReceived", [transaction], "api", function (err, transactions) {
							if (err) {
								return cb(err, transaction);
							}

							return cb(null, {transaction: transactions[0]});
						});
					});
				});
			} else {
				self.setAccountAndGet({ publicKey: keypair.publicKey.toString('hex') }, function (err, account) {
					if (err) {
						return cb(err);
					}

					if (!account || !account.publicKey) {
						return cb('Account not found');
					}

					if (account.secondSignature && !req.body.secondSecret) {
						return cb('Invalid second passphrase');
					}

					var secondKeypair = null;

					if (account.secondSignature) {
						secondKeypair = library.crypto.makeKeypair(req.body.secondSecret);
					}

					var transaction;

					try {
						transaction = library.logic.transaction.create({
							type: transactionTypes.VOTE,
							votes: req.body.delegates,
							sender: account,
							keypair: keypair,
							secondKeypair: secondKeypair
						});
					} catch (e) {
						return cb(e.toString());
					}

					library.bus.message("transactionsReceived", [transaction], "api", function (err, transactions) {
						if (err) {
							return cb(err, transaction);
						}

						return cb(null, {transaction: transactions[0]});
					});
				});
			}
	});
};

shared.getAccount = function (req, cb) {
	library.schema.validate(req.body, schema.getAccount, function (err) {
		if (err) {
			return cb(err[0].message);
		}

		var isAddress = /^[1-9A-Za-z]{1,35}$/g;
		if (!isAddress.test(req.body.address)) {
			return cb('Invalid address');
		}

		self.getAccount({ address: req.body.address }, function (err, account) {
			if (err) {
				return cb(err);
			}

			if (!account) {
				return cb('Account not found');
			}

			return cb(null, {
				account: {
					address: account.address,
					unconfirmedBalance: account.u_balance,
					balance: account.balance,
					publicKey: account.publicKey,
					unconfirmedSignature: account.u_secondSignature,
					secondSignature: account.secondSignature,
					secondPublicKey: account.secondPublicKey,
					multisignatures: account.multisignatures || [],
					u_multisignatures: account.u_multisignatures || []
				}
			});
		});
	});
};

// Export
module.exports = Accounts;
