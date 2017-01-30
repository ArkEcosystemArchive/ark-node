'use strict'; /*jslint mocha:true, expr:true */

var crypto = require('crypto');
var node = require('./../node.js');

var account = node.randomAccount();
var account2 = node.randomAccount();

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

	describe('registering a delegate', function () {

		it('using undefined transaction', function (done) {
			postTransaction(undefined, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				node.expect(res.body).to.have.property('error').to.equal("TypeError: Cannot read property 'type' of null");
				done();
			});
		});

		it('using undefined transaction.asset', function (done) {
			var transaction = node.ark.delegate.createDelegate(node.randomPassword(), node.randomDelegateName().toLowerCase());
			transaction.fee = node.fees.delegateRegistrationFee;

			delete transaction.asset;

			postTransaction(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				node.expect(res.body).to.have.property('message').to.equal("Invalid transaction detected");
				done();
			});
		});

		describe('when account has no funds', function () {

			it('should fail', function (done) {
				var transaction = node.ark.delegate.createDelegate(node.randomPassword(), node.randomDelegateName().toLowerCase());
				transaction.fee = node.fees.delegateRegistrationFee;

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
					amount: node.fees.delegateRegistrationFee,
					recipientId: account.address
				}, done);
			});

			it('using invalid username should fail', function (done) {
				var transaction = node.ark.delegate.createDelegate(account.password, crypto.randomBytes(64).toString('hex'));
				transaction.fee = node.fees.delegateRegistrationFee;

				postTransaction(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.not.ok;
					done();
				});
			});

			it('using uppercase username should fail', function (done) {
				account.username = node.randomDelegateName().toUpperCase();
				var transaction = node.ark.delegate.createDelegate(account.password, account.username);

				postTransaction(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.not.ok;
					done();
				});
			});

			describe('when lowercased username already registered', function () {
				it('using uppercase username should fail', function (done) {
					var transaction = node.ark.delegate.createDelegate(account2.password, account.username.toUpperCase());

					postTransaction(transaction, function (err, res) {
						node.expect(res.body).to.have.property('success').to.be.not.ok;
						done();
					});
				});
			});

			it('using lowercase username should be ok', function (done) {
				account.username = node.randomDelegateName().toLowerCase();
				var transaction = node.ark.delegate.createDelegate(account.password, account.username);

				postTransaction(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.ok;
					node.expect(res.body).to.have.property('transactionIds');
					node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
					done();
				});
			});
		});

		describe('twice within the same block', function () {

			before(function (done) {
				sendArk({
					secret: node.gAccount.password,
					amount: (node.fees.delegateRegistrationFee * 2),
					recipientId: account2.address
				}, done);
			});

			it('should fail', function (done) {
				account2.username = node.randomDelegateName().toLowerCase();
				var transaction = node.ark.delegate.createDelegate(account2.password, account2.username);

				account2.username = node.randomDelegateName().toLowerCase();
				var transaction2 = node.ark.delegate.createDelegate(account2.password, account2.username);

				postTransaction(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.ok;

					postTransaction(transaction2, function (err, res) {
						node.expect(res.body).to.have.property('success').to.be.not.ok;
						done();
					});
				});
			});
		});
	});
});
