'use strict'; /*jslint mocha:true, expr:true */

var crypto = require('crypto');
var node = require('./../node.js');

var account = node.randomAccount();
var account2 = node.randomAccount();
var account3 = node.randomAccount();

function postTransaction (transaction, done) {
	node.post('/peer/transactions', {
		transactions: [transaction]
	}, function (err, res) {
		done(err, res);
	});
}

function sendArk (params, done) {
	var transaction = node.ark.transaction.createTransaction(params.recipientId, params.amount, null, params.secret);

	postTransaction(transaction, function (err, res) {
		node.expect(res.body).to.have.property('success').to.be.ok;
		node.onNewBlock(function (err) {
			done(err, res);
		});
	});
}

describe('POST /peer/transactions', function () {


	describe('enabling second signature', function () {

		it('using undefined transaction', function (done) {
			postTransaction(undefined, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				node.expect(res.body).to.have.property('error').to.equal("TypeError: Cannot read property 'type' of null");
				done();
			});
		});

		it('using undefined transaction.asset', function (done) {
			var transaction = node.ark.signature.createSignature(node.randomPassword(), node.randomPassword());

			delete transaction.asset;

			postTransaction(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				node.expect(res.body).to.have.property('error').to.equal("TypeError: Cannot read property 'signature' of undefined");
				done();
			});
		});

		describe('when account has no funds', function () {

			it('should fail', function (done) {
				var transaction = node.ark.signature.createSignature(node.randomPassword(), node.randomPassword());

				postTransaction(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.not.ok;
					node.expect(res.body).to.have.property('error').to.match(/Account does not have enough ARK: [a-zA-Z0-9]+ balance: 0/);
					done();
				});
			});
		});

		describe('when account has funds', function () {

			before(function (done) {
				sendArk({
					secret: node.gAccount.password,
					amount: node.fees.secondPasswordFee + 100000000,
					recipientId: account.address
				}, done);
			});

			it('should be ok', function (done) {
				var transaction = node.ark.signature.createSignature(account.password, account.secondPassword);
				transaction.fee = node.fees.secondPasswordFee;

				postTransaction(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.ok;
					node.expect(res.body).to.have.property('transactionIds');
					node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
					done();
				});
			});
		});
	});

	describe('using second signature', function () {

		var testaccount = node.randomAccount();

		before(function (done) {
			node.onNewBlock(function (err) {
				done();
			});
		});

		it('when account does not have one should fail', function (done) {
			var transaction = node.ark.transaction.createTransaction(testaccount.address, 1, null, node.gAccount.password, account.secondPassword);

			postTransaction(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				done();
			});
		});

		it('using blank second passphrase should fail', function (done) {
			var transaction = node.ark.transaction.createTransaction(testaccount.address, 1, null, account.password, '');

			postTransaction(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				done();
			});
		});

		it('using fake second passphrase should fail', function (done) {
			var transaction = node.ark.transaction.createTransaction(testaccount.address, 1, null, account.password, account2.secondPassword);
			transaction.signSignature = crypto.randomBytes(64).toString('hex');
			transaction.id = node.ark.crypto.getId(transaction);

			postTransaction(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				done();
			});
		});

		it('using valid second passphrase should be ok', function (done) {
			var transaction = node.ark.transaction.createTransaction(testaccount.address, 1, null, account.password, account.secondPassword);

			postTransaction(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;
				node.expect(res.body).to.have.property('transactionIds');
				node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
				done();
			});
		});
	});
});
