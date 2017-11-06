'use strict';
process.env.SILENT='true';
// Root object
var node = {};
var networkName = "testnet"
var network = require('../networks.json')[networkName];
node.ark = require('arkjs');
node.ark.crypto.setNetworkVersion(network.pubKeyHash);

// Requires
node.bignum = require('../helpers/bignum.js');
node.config = require('./config.json');
node.constants = require('../helpers/constants.js');
node.txTypes = require('../helpers/transactionTypes.js');
node.delegates = require('./delegatesPassphrases.'+networkName+'.json');
node.gAccount = require('./genesisPassphrase.'+networkName+'.json');
node.gAccount.password = node.gAccount.passphrase;

node._ = require('lodash');
node.async = require('async');
node.popsicle = require('popsicle');
node.expect = require('chai').expect;
node.chai = require('chai');
node.chai.config.includeStack = true;
node.chai.use(require('chai-bignumber')(node.bignum));
node.supertest = require('supertest');
require('colors');

// Node configuration
//node.baseUrl = 'http://' + node.config.address + ':' + node.config.port;
node.baseUrl = 'http://localhost:' + node.config.port;
node.api = node.supertest(node.baseUrl);

node.normalizer = 100000000; // Use this to convert ARK amount to normal value
node.blockTime = 10000; // Block time in miliseconds
node.blockTimePlus = 12000; // Block time + 2 seconds in miliseconds
node.version = '0.0.0'; // Node version

// Transaction fees
node.fees = {
	voteFee: node.constants.fees.vote,
	transactionFee: node.constants.fees.send,
	secondPasswordFee: node.constants.fees.secondsignature,
	delegateRegistrationFee: node.constants.fees.delegate,
	multisignatureRegistrationFee: node.constants.fees.multisignature
};


// Existing delegate account
node.eAccount = node.delegates[0];
node.eAccount.password = node.eAccount.passphrase;

console.log(node.eAccount);
// Genesis account, initially holding 125M total supply

// Optional logging
if (process.env.SILENT === 'true') {
	node.debug = function () {};
} else {
	node.debug = console.log;
}

// Random ARK amount
node.Ark = Math.floor(Math.random() * (100000 * 100000000)) + 1;

// Returns a random delegate name
node.randomDelegateName = function () {
	var size = node.randomNumber(1, 20); // Min. delegate name size is 1, Max. delegate name is 20
	var delegateName = '';
	var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&_.';

	for (var i = 0; i < size; i++) {
		delegateName += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return delegateName;
};

// Returns a random property from the given object
node.randomProperty = function (obj, needKey) {
	var keys = Object.keys(obj);

	if (!needKey) {
		return obj[keys[keys.length * Math.random() << 0]];
	} else {
		return keys[keys.length * Math.random() << 0];
	}
};

// Returns random ARK amount
node.randomArk = function () {
	return Math.floor(Math.random() * (100 * 100000000)) + (10 * 100000000);
};

// Returns current block height
node.getHeight = function (cb) {
	var request = node.popsicle.get(node.baseUrl + '/api/blocks/getHeight');

	request.use(node.popsicle.plugins.parse(['json']));

	request.then(function (res) {
		if (res.status !== 200) {
			return setImmediate(cb, ['Received bad response code', res.status, res.url].join(' '));
		} else {
			return setImmediate(cb, null, res.body.height);
		}
	});

	request.catch(function (err) {
		return setImmediate(cb, err);
	});
};

// Upon detecting a new block, do something
node.onNewBlock = function (cb) {
	node.getHeight(function (err, height) {
		if (err) {
			return cb(err);
		} else {
			node.waitForNewBlock(height, cb);
		}
	});
};

// Waits for a new block to be created
node.waitForNewBlock = function (height, cb) {
	var actualHeight = height;
	var counter = 1;

	node.async.doWhilst(
		function (cb) {
			var request = node.popsicle.get(node.baseUrl + '/api/blocks/getHeight');

			request.use(node.popsicle.plugins.parse(['json']));

			request.then(function (res) {
				if (res.status !== 200) {
					return cb(['Received bad response code', res.status, res.url].join(' '));
				}

				if (height + 1 === res.body.height) {
					height = res.body.height;
				}

				node.debug('	Waiting for block:'.grey, 'Height:'.grey, res.body.height, 'Second:'.grey, counter++);
				setTimeout(cb, 1000);
			});

			request.catch(function (err) {
				return cb(err);
			});
		},
		function () {
			return actualHeight === height;
		},
		function (err) {
			if (err) {
				return setImmediate(cb, err);
			} else {
				return setImmediate(cb, null, height);
			}
		}
	);
};

// Adds peers to local node
node.addPeers = function (numOfPeers, cb) {
	var operatingSystems = ['win32','win64','ubuntu','debian', 'centos'];
	var ports = [4000, 5000, 7000, 8000];

	var os, version, port;
	var i = 0;

	node.async.whilst(function () {
		return i < numOfPeers;
	}, function (next) {
		os = operatingSystems[node.randomizeSelection(operatingSystems.length)];
		version = node.config.version;
		port = ports[node.randomizeSelection(ports.length)];

		var request = node.popsicle.get({
			url: node.baseUrl + '/peer/height',
			headers: {
				version: version,
				port: port,
				nethash: node.config.nethash,
				os: os
			}
		});

		request.use(node.popsicle.plugins.parse(['json']));

		request.then(function (res) {
			if (res.status !== 200) {
				return next(['Received bad response code', res.status, res.url].join(' '));
			} else {
				i++;
				next();
			}
		});

		request.catch(function (err) {
			return next(err);
		});
	}, function (err) {
		return cb(err, {os: os, version: version, port: port});
	});
};

// Returns a random index for an array
node.randomizeSelection = function (length) {
	return Math.floor(Math.random() * length);
};

// Returns a random number between min (inclusive) and max (exclusive)
node.randomNumber = function (min, max) {
	return	Math.floor(Math.random() * (max - min) + min);
};

// Returns the expected fee for the given amount
node.expectedFee = function (amount) {
	return parseInt(node.fees.transactionFee);
};

// Returns a random username
node.randomUsername = function () {
	var size = node.randomNumber(1, 16); // Min. username size is 1, Max. username size is 16
	var username = '';
	var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&_.';

	for (var i = 0; i < size; i++) {
		username += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return username;
};

// Returns a random capitialized username
node.randomCapitalUsername = function () {
	var size = node.randomNumber(1, 16); // Min. username size is 1, Max. username size is 16
	var username = 'A';
	var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@$&_.';

	for (var i = 0; i < size - 1; i++) {
		username += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return username;
};

// Returns a random application name
node.randomApplicationName = function () {
	var size = node.randomNumber(1, 32); // Min. username size is 1, Max. username size is 32
	var name = 'A';
	var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	for (var i = 0; i < size - 1; i++) {
		name += possible.charAt(Math.floor(Math.random() * possible.length));
	}

	return name;
};

// Returns a basic random account
node.randomAccount = function () {
	var account = {
		balance: '0'
	};

	account.password = node.randomPassword();
	account.secondPassword = node.randomPassword();
	account.username = node.randomDelegateName();
	account.publicKey = node.ark.crypto.getKeys(account.password, network).publicKey;
	account.address = node.ark.crypto.getAddress(account.publicKey, network.pubKeyHash);

	return account;
};

// Returns an extended random account
node.randomTxAccount = function () {
	return node._.defaults(node.randomAccount(), {
		sentAmount:'',
		paidFee: '',
		totalPaidFee: '',
		transactions: []
	});
};

// Returns a random password
node.randomPassword = function () {
	return Math.random().toString(36).substring(7);
};

// Abstract request
function abstractRequest (options, done) {
	var request = node.api[options.verb.toLowerCase()](options.path);

	request.set('Accept', 'application/json');
	request.set('version', node.version);
	request.set('nethash', node.config.nethash);
	request.set('port', node.config.port);

	request.expect('Content-Type', /json/);
	request.expect(200);

	if (options.params) {
		request.send(options.params);
	}

	node.debug(['> Path:'.grey, options.verb.toUpperCase(), options.path].join(' '));
	node.debug('> Data:'.grey, JSON.stringify(options.params));

	if (done) {
		request.end(function (err, res) {
			node.debug('> Response:'.grey, JSON.stringify(res.body));
			done(err, res);
		});
	} else {
		return request;
	}
}

// Get the given path
node.get = function (path, done) {
	return abstractRequest({ verb: 'GET', path: path, params: null }, done);
};

// Post to the given path
node.post = function (path, params, done) {
	return abstractRequest({ verb: 'POST', path: path, params: params }, done);
};

// Put to the given path
node.put = function (path, params, done) {
	return abstractRequest({ verb: 'PUT', path: path, params: params }, done);
};

// Exports
module.exports = node;
