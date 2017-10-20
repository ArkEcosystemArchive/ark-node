'use strict'; /*jslint mocha:true, expr:true */

var node = require('./../node.js');

var account = node.randomAccount();

describe('GET /api/accounts/getBalance?address=', function () {

	function getBalance (address, done) {
		node.get('/api/accounts/getBalance?address=' + address, done);
	}

	it('using known address should be ok', function (done) {
		getBalance(node.gAccount.address, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.ok;
			node.expect(res.body).to.have.property('balance').that.is.a('string');
			node.expect(res.body).to.have.property('unconfirmedBalance').that.is.a('string');
			done();
		});
	});

	it('using unknown address should be ok', function (done) {
		getBalance(account.address, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.ok;
			node.expect(res.body).to.have.property('balance').that.is.a('string');
			node.expect(res.body).to.have.property('unconfirmedBalance').that.is.a('string');
			done();
		});
	});

	it('using invalid address should fail', function (done) {
		getBalance('éthisIsNOTAArkAddress', function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error').to.contain('Object didn\'t pass validation for format address');
			done();
		});
	});

	it('using empty address should fail', function (done) {
		getBalance('', function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error');
			node.expect(res.body.error).to.contain('String is too short (0 chars), minimum 1');
			done();
		});
	});
});

describe('GET /api/accounts/getPublicKey?address=', function () {

	function getPublicKey (address, done) {
		node.get('/api/accounts/getPublicKey?address=' + address, done);
	}

	it('using known address should be ok', function (done) {
		getPublicKey(node.gAccount.address, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.ok;
			node.expect(res.body).to.have.property('publicKey').to.equal(node.gAccount.publicKey);
			done();
		});
	});

	it('using unknown address should be ok', function (done) {
		getPublicKey(account.address, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error').to.contain('Account not found');
			done();
		});
	});

	it('using invalid address should fail', function (done) {
		getPublicKey('éthisIsNOTAArkAddress', function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error').to.contain('Object didn\'t pass validation for format address');
			done();
		});
	});

	it('using empty address should fail', function (done) {
		getPublicKey('', function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error');
			node.expect(res.body.error).to.contain('String is too short (0 chars), minimum 1');
			done();
		});
	});
});

describe('GET /accounts?address=', function () {

	function getAccounts (address, done) {
		node.get('/api/accounts?address=' + address, done);
	}

	it('using known address should be ok', function (done) {
		getAccounts(node.gAccount.address, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.ok;
			node.expect(res.body).to.have.property('account').that.is.an('object');
			node.expect(res.body.account).to.have.property('address').to.equal(node.gAccount.address);
			node.expect(res.body.account).to.have.property('unconfirmedBalance').that.is.a('string');
			node.expect(res.body.account).to.have.property('balance').that.is.a('string');
			node.expect(res.body.account).to.have.property('publicKey').to.equal(node.gAccount.publicKey);
			node.expect(res.body.account).to.have.property('unconfirmedSignature').to.equal(0);
			node.expect(res.body.account).to.have.property('secondSignature').to.equal(0);
			node.expect(res.body.account).to.have.property('secondPublicKey').to.equal(null);
			node.expect(res.body.account).to.have.property('multisignatures').to.a('array');
			node.expect(res.body.account).to.have.property('u_multisignatures').to.a('array');
			done();
		});
	});

	it('using known lowercase address should not be ok', function (done) {
		getAccounts(node.gAccount.address.toLowerCase(), function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			done();
		});
	});

	it('using unknown address should fail', function (done) {
		getAccounts(account.address, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error').to.eql('Account not found');
			done();
		});
	});

	it('using invalid address should fail', function (done) {
		getAccounts('éthisIsNOTAValidArkAddress', function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error');
			node.expect(res.body.error).to.contain('Object didn\'t pass validation for format address');
			done();
		});
	});

	it('using empty address should fail', function (done) {
		getAccounts('', function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error');
			node.expect(res.body.error).to.contain('String is too short (0 chars), minimum 1');
			done();
		});
	});
});
