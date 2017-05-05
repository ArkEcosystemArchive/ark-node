'use strict'; /*jslint mocha:true, expr:true */

var async = require('async');
var node = require('./../node.js');

var account = node.randomAccount();

var delegate;
var delegates = [];
var votedDelegates = [];

function getDelegates (done) {
	node.get('/api/delegates', function (err, res) {
		node.expect(res.body).to.have.property('success').to.be.ok;
		node.expect(res.body).to.have.property('delegates').that.is.an('array');
		return done(err, res);
	});
}

function getVotes (address, done) {
	node.get('/api/accounts/delegates/?address=' + address, function (err, res) {
		node.expect(res.body).to.have.property('success').to.be.ok;
		node.expect(res.body).to.have.property('delegates').that.is.an('array');
		return done(err, res);
	});
}

function postVotes (params, done) {
	var count = 0;
	var limit = 1;

	async.whilst(
		function () {
			return count < limit;
		}, function (untilCb) {
			node.onNewBlock(function (err) {
				count++;
				return untilCb();
			});
		}, function (err) {
			async.eachSeries(params.delegates, function (delegate, eachCb) {
				var transaction = node.ark.vote.createVote(params.passphrase, [params.action + delegate]);

				postVote(transaction, function (err, res) {
					params.voteCb(err, res);
					return eachCb();
				});
			}, function (err) {
				node.onNewBlock(function (err) {
					return done(err);
				});
			});
		}
	);
}

function postVote (transaction, done) {
	node.post('/peer/transactions', { transactions: [transaction] }, function (err, res) {
		return done(err, res);
	});
}

function sendArk (params, done) {
	node.put('/api/transactions', params, function (err, res) {
		node.expect(res.body).to.have.property('success').to.be.ok;
		node.onNewBlock(function (err) {
			return done(err, res);
		});
	});
}

function registerDelegate (account, done) {
	account.username = node.randomDelegateName().toLowerCase();
	var transaction = node.ark.delegate.createDelegate(account.password, account.username);

	node.post('/peer/transactions', { transactions: [transaction] }, function (err, res) {
		node.expect(res.body).to.have.property('success').to.be.ok;
		node.onNewBlock(function (err) {
			return done(err, res);
		});
	});
}

describe('POST /peer/transactions', function () {

	before(function (done) {
		sendArk({
			secret: node.gAccount.password,
			amount: 100000000000,
			recipientId: account.address
		}, done);
	});

	before(function (done) {
		getDelegates(function (err, res) {
			delegates = res.body.delegates.map(function (delegate) {
				return delegate.publicKey;
			}).slice(0, 51);

			delegate = res.body.delegates[0].publicKey;

			done();
		});
	});

	before(function (done) {
		getVotes(account.address, function (err, res) {
			votedDelegates = res.body.delegates.map(function (delegate) {
				return delegate.publicKey;
			});

			done();
		});
	});

	before(function (done) {
		postVotes({
			delegates: votedDelegates,
			passphrase: account.password,
			action: '-',
			voteCb: function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;
			}
		}, done);
	});

	it('using undefined transaction', function (done) {
		postVote(undefined, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('error').to.equal("TypeError: Cannot read property 'type' of null");
			done();
		});
	});

	it('using undefined transaction.asset', function (done) {
		var transaction = node.ark.vote.createVote(account.password, ['+' + delegate]);

		delete transaction.asset;

		postVote(transaction, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.not.ok;
			node.expect(res.body).to.have.property('message').to.equal("Invalid transaction detected");
			done();
		});
	});

	it('voting for a delegate and then removing again within same block should fail', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, ['+' + delegate]);
			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;

				var transaction2 = node.ark.vote.createVote(account.password, ['-' + delegate]);
				postVote(transaction2, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.not.ok;
					done();
				});
			});
		});
	});

	it('removing votes from a delegate and then voting again within same block should fail', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, ['-' + delegate]);
			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;

				var transaction2 = node.ark.vote.createVote(account.password, ['+' + delegate]);
				postVote(transaction2, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.not.ok;
					done();
				});
			});
		});
	});

	it('voting twice for a delegate should fail', function (done) {
		async.series([
			function (seriesCb) {
				node.onNewBlock(function (err) {
					var transaction = node.ark.vote.createVote(account.password, ['+' + delegate]);
					postVote(transaction, function (err, res) {
						node.expect(res.body).to.have.property('success').to.be.ok;
						done();
					});
				});
			},
			function (seriesCb) {
				node.onNewBlock(function (err) {
					var transaction2 = node.ark.vote.createVote(account.password, ['+' + delegate]);
					postVote(transaction2, function (err, res) {
						node.expect(res.body).to.have.property('success').to.be.not.ok;
						done();
					});
				});
			},
		], function (err) {
			return done(err);
		});
	});

	it('removing votes from a delegate should be ok', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, ['-' + delegate]);
			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;
				node.expect(res.body).to.have.property('transactionIds');
				node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
				done();
			});
		});
	});

	it('voting for 33 delegates at once should be ok', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, delegates.slice(0, 33).map(function (delegate) {
				return '+' + delegate;
			}));

			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;
				node.expect(res.body).to.have.property('transactionIds');
				node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
				done();
			});
		});
	});

	it('removing votes from 33 delegates at once should be ok', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, delegates.slice(0, 33).map(function (delegate) {
				return '-' + delegate;
			}));

			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;
				node.expect(res.body).to.have.property('transactionIds');
				node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
				done();
			});
		});
	});

	it('voting for 34 delegates at once should fail', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, delegates.slice(0, 34).map(function (delegate) {
				return '+' + delegate;
			}));

			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				node.expect(res.body).to.have.property('error').to.equal('Voting limit exceeded. Maximum is 33 votes per transaction');
				done();
			});
		});
	});

	it('voting for 1 delegates separately should be ok', function (done) {
		node.onNewBlock(function (err) {
			postVotes({
				delegates: delegates.slice(0, 1),
				passphrase: account.password,
				action: '+',
				voteCb: function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.ok;
					node.expect(res.body).to.have.property('transactionIds');
				}
			}, done);
		});
	});

	it('removing votes from 2 delegates at once should fail', function (done) {
		node.onNewBlock(function (err) {
			var transaction = node.ark.vote.createVote(account.password, delegates.slice(0, 2).map(function (delegate) {
				return '-' + delegate;
			}));

			postVote(transaction, function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.not.ok;
				node.expect(res.body).to.have.property('error').to.equal('Voting limit exceeded. Maximum is 33 votes per transaction');
				done();
			});
		});
	});

	it('removing votes from 1 delegates separately should be ok', function (done) {
		postVotes({
			delegates: delegates.slice(0, 1),
			passphrase: account.password,
			action: '-',
			voteCb: function (err, res) {
				node.expect(res.body).to.have.property('success').to.be.ok;
				node.expect(res.body).to.have.property('transactionIds');
			}
		}, done);
	});
});

describe('POST /peer/transactions after registering a new delegate', function () {

	before(function (done) {
		getDelegates(function (err, res) {
			delegates = res.body.delegates.map(function (delegate) {
				return delegate.publicKey;
			}).slice(0, 51);

			done();
		});
	});

	before(function (done) {
		sendArk({
			secret: node.gAccount.password,
			amount: 100000000000,
			recipientId: account.address
		}, done);
	});

	before(function (done) {
		registerDelegate(account, done);
	});

	it('voting for self should be ok', function (done) {
		var transaction = node.ark.vote.createVote(account.password, ['+' + account.publicKey]);

		postVote(transaction, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.ok;
			node.expect(res.body).to.have.property('transactionIds');
			node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
			node.onNewBlock(function (err) {
				return done(err);
			});
		});
	});

	it('exceeding maximum of 1 votes within same block should fail', function (done) {
		async.series([
			function (seriesCb) {
				var slicedDelegates = delegates.slice(0, 26);
				node.expect(slicedDelegates).to.have.lengthOf(26);

				postVotes({
					delegates: slicedDelegates,
					passphrase: account.password,
					action: '+',
					voteCb: function (err, res) {
						node.expect(res.body).to.have.property('success').to.be.ok;
					}
				}, seriesCb);
			},
			function (seriesCb) {
				var slicedDelegates = delegates.slice(-25);
				node.expect(slicedDelegates).to.have.lengthOf(25);

				var transaction = node.ark.vote.createVote(account.password, slicedDelegates.map(function (delegate) {
					return '+' + delegate;
				}));

				postVote(transaction, function (err, res) {
					node.expect(res.body).to.have.property('success').to.be.not.ok;
					node.expect(res.body).to.have.property('error').to.equal('Maximum number of 51 votes exceeded (1 too many)');
					seriesCb();
				});
			}
		], function (err) {
			return done(err);
		});
	});

	it('removing vote from self should be ok', function (done) {
		var transaction = node.ark.vote.createVote(account.password, ['-' + account.publicKey]);

		postVote(transaction, function (err, res) {
			node.expect(res.body).to.have.property('success').to.be.ok;
			node.expect(res.body).to.have.property('transactionIds');
			node.expect(res.body.transactionIds[0]).to.equal(transaction.id);
			done();
		});
	});
});
