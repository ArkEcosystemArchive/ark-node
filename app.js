'use strict';

var appConfig = require('./config.json');
var networks = require('./networks.json');
var async = require('async');
var checkIpInList = require('./helpers/checkIpInList.js');
var extend = require('extend');
var fs = require('fs');
var genesisblock = require('./genesisBlock.json');
var arkjs = require('arkjs');
var https = require('https');
var Logger = require('./logger.js');
var packageJson = require('./package.json');
var path = require('path');
var program = require('commander');
var Sequence = require('./helpers/sequence.js');
var util = require('util');
var z_schema = require('./helpers/z_schema.js');
var colors = require('colors');
var vorpal = require('vorpal')();
var spawn = require('child_process').spawn;
var requestIp = require('request-ip');

process.stdin.resume();

var versionBuild = fs.readFileSync(path.join(__dirname, 'build'), 'utf8');

program
	.version(packageJson.version)
	.option('-c, --config <path>', 'config file path')
	.option('-g, --genesis <path>', 'genesis block')
	.option('-n, --networks <path>', 'networks definition file')
	.option('-p, --port <port>', 'listening port number')
	.option('-a, --address <ip>', 'listening host name or ip')
	.option('-x, --peers [peers...]', 'peers list')
	.option('-l, --log <level>', 'log level')
	.option('-i, --interactive', 'launch cli')
	.parse(process.argv);

if (program.config) {
	appConfig = require(path.resolve(process.cwd(), program.config));
}

if (program.genesis) {
	genesisblock = require(path.resolve(process.cwd(), program.genesis));
}

if (program.networks) {
	networks = require(path.resolve(process.cwd(), program.networks));
}

if (program.port) {
	appConfig.port = program.port;
}

if (program.address) {
	appConfig.address = program.address;
}

if (program.peers) {
	if (typeof program.peers === 'string') {
		appConfig.peers.list = program.peers.split(',').map(function (peer) {
			peer = peer.split(':');
			return {
				ip: peer.shift(),
				port: peer.shift() || appConfig.port
			};
		});
	} else {
		appConfig.peers.list = [];
	}
}

if (program.log) {
	appConfig.consoleLogLevel = program.log;
}

if (program.interactive) {
	appConfig.consoleLogLevel = "none";
}

var config = {
	db: appConfig.db,
	modules: {
		accounts: './modules/accounts.js',
		transactions: './modules/transactions.js',
		blocks: './modules/blocks.js',
		signatures: './modules/signatures.js',
		transport: './modules/transport.js',
		loader: './modules/loader.js',
		system: './modules/system.js',
		peers: './modules/peers.js',
		delegates: './modules/delegates.js',
		rounds: './modules/rounds.js',
		multisignatures: './modules/multisignatures.js',
		transactionPool: './modules/transactionPool.js',
		blockchain: './modules/blockchain.js',
		nodeManager: './modules/nodeManager.js'
	}
};

if(appConfig.network){
	appConfig.network = networks[appConfig.network];
}

else {
	appConfig.network = networks.ark;
}

if(appConfig.modules){
	for(var name in appConfig.modules){
		config.modules[name]=appConfig.modules[name];
	}
}

var logger = new Logger({ echo: appConfig.consoleLogLevel, errorLevel: appConfig.fileLogLevel, filename: appConfig.logFileName });

var d = require('domain').create();

d.on('error', function (err) {
	logger.fatal('Domain master', { message: err.message, stack: err.stack });
	process.exit(0);
});

d.run(function () {
	var modules = [];
	console.log(colors.cyan("\n\
      {_       {_______    {__   {__       {___     {__    {____     {_____    {________\n\
     {_ __     {__    {__  {__  {__        {_ {__   {__  {__    {__  {__   {__ {__\n\
    {_  {__    {__    {__  {__ {__         {__ {__  {__{__        {__{__    {__{__\n\
   {__   {__   {_ {__      {_ {_           {__  {__ {__{__        {__{__    {__{______\n\
  {______ {__  {__  {__    {__  {__        {__   {_ {__{__        {__{__    {__{__\n\
 {__       {__ {__    {__  {__   {__       {__    {_ __  {__     {__ {__   {__ {__\n\
{__         {__{__      {__{__     {__     {__      {__    {____     {_____    {________\n\
\n\n\
	                     W E L C O M E  A B O A R D !\n\
\n\
"));
	async.auto({
		config: function (cb) {
			try {
				appConfig.nethash = new Buffer(genesisblock.payloadHash, 'hex').toString('hex');
			} catch (e) {
				logger.error('Failed to assign nethash from genesis block');
				throw Error(e);
			}
			cb(null, appConfig);
		},

		logger: function (cb) {
			cb(null, logger);
		},

		build: function (cb) {
			cb(null, versionBuild);
		},

		genesisblock: function (cb) {
			cb(null, {
				block: genesisblock
			});
		},

		schema: function (cb) {
			var schema = new z_schema(appConfig.network).z_schema
			cb(null, new schema());
		},

		network: ['config', function (scope, cb) {
			var express = require('express');
			var compression = require('compression');
			var cors = require('cors');
			var app = express();

			require('./helpers/request-limiter')(app, appConfig);

			app.use(compression({ level: 6 }));
			app.use(cors());
			app.options('*', cors());

			var server = require('http').createServer(app);
			var io = require('socket.io')(server);

			var privateKey, certificate, https, https_io;

			if (scope.config.ssl.enabled) {
				privateKey = fs.readFileSync(scope.config.ssl.options.key);
				certificate = fs.readFileSync(scope.config.ssl.options.cert);

				https = require('https').createServer({
					key: privateKey,
					cert: certificate,
					ciphers: 'ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:' + 'ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:' + '!aNULL:!eNULL:!EXPORT:!DES:!RC4:!MD5:!PSK:!SRP:!CAMELLIA'
				}, app);

				https_io = require('socket.io')(https);
			}

			cb(null, {
				express: express,
				app: app,
				server: server,
				io: io,
				https: https,
				https_io: https_io
			});
		}],

		//TODO: to move to modules/transactions.js ?
		//To be deprecated in favor of blocksequence, encapsulating unconfirmed tx application in a blocksequence.
		//To balance transaction application (unconfirmed and confirmed)
		transactionSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Transaction queue', current);
				}
			});
			cb(null, sequence);
		}],

		// To balance block processing
		blockSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Block queue', current);
				}
			});
			cb(null, sequence);
		}],

		// To balance logic (rebuilding, syncing, downloading blocks, swapping blocks, etc...)
		managementSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Block queue', current);
				}
			});
			cb(null, sequence);
		}],

		//To balance db write
		dbSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('DB queue', current);
				}
			});
			cb(null, sequence);
		}],

		//To balance block reception via API
		receiveBlockSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Receive Block queue', current);
				}
			});
			cb(null, sequence);
		}],

		//To balance API calls
		balancesSequence: ['logger', function (scope, cb) {
			var sequence = new Sequence({
				onWarning: function (current, limit) {
					scope.logger.warn('Balance queue', current);
				}
			});
			cb(null, sequence);
		}],

		connect: ['config', 'genesisblock', 'logger', 'build', 'network', function (scope, cb) {
			var path = require('path');
			var bodyParser = require('body-parser');
			var methodOverride = require('method-override');
			var requestSanitizer = require('./helpers/request-sanitizer');
			var queryParser = require('express-query-int');

			scope.network.app.engine('html', require('ejs').renderFile);
			scope.network.app.use(bodyParser.raw({limit: '4mb'}));
			scope.network.app.use(bodyParser.urlencoded({extended: true, limit: '2mb', parameterLimit: 5000}));
			scope.network.app.use(bodyParser.json({limit: '4mb'}));
			scope.network.app.use(methodOverride());

			var ignore = ['id', 'name', 'lastBlockId', 'blockId', 'transactionId', 'address', 'recipientId', 'senderId', 'previousBlock'];

			scope.network.app.use(queryParser({
				parser: function (value, radix, name) {
					if (ignore.indexOf(name) >= 0) {
						return value;
					}

					/*jslint eqeq: true*/
					if (isNaN(value) || parseInt(value) != value || isNaN(parseInt(value, radix))) {
						return value;
					}

					return parseInt(value);
				}
			}));

			scope.network.app.use(require('./helpers/z_schema-express.js')(scope.schema));

			scope.network.app.use(function (req, res, next) {
				var parts = req.url.split('/');
				var ip = requestIp.getClientIp(req);

				// Log client connections
				logger.trace(req.method + ' ' + req.url + ' from ' + ip + ":" + req.headers.port);
				/* Instruct browser to deny display of <frame>, <iframe> regardless of origin.
				 *
				 * RFC -> https://tools.ietf.org/html/rfc7034
				 */
				res.setHeader('X-Frame-Options', 'DENY');

				/* Set Content-Security-Policy headers.
				 *
				 * frame-ancestors - Defines valid sources for <frame>, <iframe>, <object>, <embed> or <applet>.
				 *
				 * W3C Candidate Recommendation -> https://www.w3.org/TR/CSP/
				 */
				res.setHeader('Content-Security-Policy', 'frame-ancestors \'none\'');

				if (parts.length > 1) {
					if (parts[1] === 'api') {
						if (!checkIpInList(scope.config.api.access.whiteList, ip, true)) {
							res.sendStatus(403);
						} else {
							next();
						}
					} else if (parts[1] === 'peer') {
						if (checkIpInList(scope.config.peers.blackList, ip, false)) {
							res.sendStatus(403);
						} else {
							next();
						}
					} else {
						next();
					}
				} else {
					next();
				}
			});

			scope.network.server.listen(scope.config.port, scope.config.address, function (err) {
				scope.logger.info('# Ark node server started on: ' + scope.config.address + ':' + scope.config.port);

				if (!err) {
					if (scope.config.ssl.enabled) {
						scope.network.https.listen(scope.config.ssl.options.port, scope.config.ssl.options.address, function (err) {
							scope.logger.info('Ark https started: ' + scope.config.ssl.options.address + ':' + scope.config.ssl.options.port);

							cb(err, scope.network);
						});
					} else {
						cb(null, scope.network);
					}
				} else {
					cb(err, scope.network);
				}
			});

			if(program.interactive){
				startInteractiveMode(scope);
			}

		}],

		crypto: ['config', function (scope, cb) {
			var crypto = require('./helpers/crypto.js')
			cb(null, new crypto(scope));
		}],

		bus: ['crypto', function (scope, cb) {
			var changeCase = require('change-case');
			var bus = function () {
				this.message = function () {
					var args = [];
					Array.prototype.push.apply(args, arguments);
					var topic = args.shift();
					modules.forEach(function (module) {
						var eventName = 'on' + changeCase.pascalCase(topic);
						if (typeof(module[eventName]) === 'function') {
							module[eventName].apply(module[eventName], args);
						}
					});
				};
			};
			cb(null, new bus());
		}],

		db: function (cb) {
			var db = require('./helpers/database.js');
			db.connect(config.db, logger, cb);
		},

		logic: ['db', 'bus', 'schema', 'genesisblock', function (scope, cb) {
			var Transaction = require('./logic/transaction.js');
			var Block = require('./logic/block.js');
			var Account = require('./logic/account.js');

			async.auto({
				bus: function (cb) {
					cb(null, scope.bus);
				},
				db: function (cb) {
					cb(null, scope.db);
				},
				crypto: function (cb) {
					cb(null, scope.crypto);
				},
				logger: function (cb) {
					cb(null, logger);
				},
				schema: function (cb) {
					cb(null, scope.schema);
				},
				genesisblock: function (cb) {
					cb(null, {
						block: genesisblock
					});
				},
				account: ['db', 'bus', 'crypto', 'schema', 'genesisblock', function (scope, cb) {
					new Account(scope, cb);
				}],
				transaction: ['db', 'bus', 'crypto', 'schema', 'genesisblock', 'account', function (scope, cb) {
					new Transaction(scope, cb);
				}],
				block: ['db', 'bus', 'crypto', 'schema', 'genesisblock', 'account', 'transaction', function (scope, cb) {
					new Block(scope, cb);
				}]
			}, cb);
		}],

		modules: ['network', 'connect', 'config', 'logger', 'bus', 'managementSequence', 'blockSequence', 'transactionSequence', 'dbSequence', 'balancesSequence', 'db', 'logic', function (scope, cb) {
			var tasks = {};

			Object.keys(config.modules).forEach(function (name) {
				tasks[name] = function (cb) {
					var d = require('domain').create();

					d.on('error', function (err) {
						scope.logger.fatal('Domain ' + name, {message: err.message, stack: err.stack});
					});

					d.run(function () {
						logger.debug('Loading module', name);
						var Klass = require(config.modules[name]);
						var obj = new Klass(cb, scope);
						modules.push(obj);
					});
				};
			});

			async.parallel(tasks, function (err, results) {
				cb(err, results);
			});
		}],

		ready: ['modules', 'bus', function (scope, cb) {
			scope.bus.message('bind', scope.modules);
			cb();
		}]
	}, function (err, scope) {
		if (err) {
			scope.logger.fatal(err);
		} else {

			scope.logger.info('Modules ready and launched');

			scope.modules.nodeManager.startApp();

			process.once('cleanup', function () {
				scope.logger.info('Cleaning up...');
				async.eachSeries(modules, function (module, cb) {
					if (typeof(module.cleanup) === 'function') {
						module.cleanup(cb);
					} else {
						cb();
					}
				}, function (err) {
					if (err) {
						scope.logger.error(err);
					} else {
						scope.logger.info('Cleaned up successfully');
					}
					process.exit(1);
				});
			});

			process.once('SIGTERM', function () {
				scope.logger.info('caught SIGTERM');
				process.emit('cleanup');
			});

			process.once('exit', function () {
				scope.logger.info('caught internal exit');
				process.emit('cleanup');
			});

			process.once('SIGINT', function () {
				scope.logger.info('caught SIGINT');
				process.emit('cleanup');
			});
		}
	});
});

process.on('uncaughtException', function (err) {
	// Handle error safely
	logger.fatal('System error', { message: err.message, stack: err.stack });
	process.emit('cleanup');
});

function startInteractiveMode(scope){
	vorpal
	  .command('rebuild', 'Rebuild node from scratch')
	  .action(function(args, callback) {
	    this.log('Not Implemented');
	    callback();
	  });

	vorpal
	  .command('status', 'Send status of the node')
	  .action(function(args, callback) {
			var self = this;
			scope.modules.loader.getNetwork(true, function(err, network){
				var lastBlock = scope.modules.blockchain.getLastBlock();
				self.log("Network Height:", network.height);
				self.log("Node Height:", lastBlock.height, network.height>lastBlock.height?colors.red("(not sync)"):colors.green("(in sync)"));
				callback();
			});
			self.log("Forging:", scope.modules.delegates.isForging());
			self.log("Active Delegate:", scope.modules.delegates.isActiveDelegate());
			var peers = scope.modules.peers.listBroadcastPeers();
			self.log("Connected Peers:", peers.length);
			self.log("Mempool size:", scope.modules.transactionPool.getMempoolSize());

	  });

	var tail;

	vorpal
	  .command('log start', 'Start output logs')
	  .action(function(args, callback) {
			var self=this;
			if(tail){
				self.log("Already listening to logs");
				return callback();
			}
			tail = spawn('tail', ['-f', appConfig.logFileName]);
			tail.stdout.on('data', function(data) {
			  self.log(data.toString("UTF-8"));
			});
			callback();
	  });

	vorpal
	  .command('log stop', 'Stop output logs')
	  .action(function(args, callback) {
			var self=this;
			if(tail){
				tail.kill();
				tail=null;
			}
			callback();
	  });

	vorpal
	  .command('log grep <query>', 'Grep logs with <query>')
	  .action(function(args, callback) {
			var self=this;
			var grep = spawn('grep', ['-e', args.query, appConfig.logFileName]);
			grep.stdout.on('data', function(data) {
			  self.log(data.toString("UTF-8"));
			});
			callback();
	  });

	vorpal
	  .command('update node', 'force update from network')
	  .action(function(args, callback) {
			var self = this;
	    scope.bus.message("updatePeers");
	    callback();
	  });

	vorpal
	  .command('sql <query>', 'query database')
	  .action(function(args, callback) {
			var self = this;
	    scope.db.query(args.query).then(function(rows){
				self.log(rows.map(function(row){return JSON.stringify(row)}).join("\n"));
				callback();
			}).catch(function(error){
				self.log(error);
				callback();
			});

	  });

	vorpal
	  .command('create account', 'generate a new random account')
	  .action(function(args, callback) {
			var self = this;
	    var passphrase = require("bip39").generateMnemonic();
			self.log("Seed    - private:",passphrase);
			self.log("WIF     - private:",require("arkjs").crypto.getKeys(passphrase).toWIF());
			self.log("Address - public :",require("arkjs").crypto.getAddress(require("arkjs").crypto.getKeys(passphrase).publicKey));
			callback();
	  });
	var account=null;
	vorpal
	  .mode('account <address>', 'get info of account (balance, vote, username, publicKey etc...)')
	  .delimiter('account>')
	  .init(function(args, callback){
	    var self=this;
			scope.db.query("select * from mem_accounts where address ='"+args.address+"'").then(function(rows){
				account=rows[0];
				self.log('Managing account '+args.address+'. Commands: '+Object.keys(account).join(", ")+'. To exit, type `exit`.');
				callback();
			}).catch(function(error){
				account={};
				self.log('Account not found '+args.address+'. To exit, type `exit`.');
				callback();
			});
	  })
	  .action(function(command, callback) {
	    var self = this;
	    this.log(account[command]);
			callback();
	  });

		vorpal
		  .command('spv fix', 'fix database using SPV on all accounts')
		  .action(function(args, callback) {
				var self = this;
				scope.modules.nodeManager.fixDatabase(function(err, results){
					if(err) self.log(colors.red(err));
					else self.log("Fixed "+results[3].length+" accounts");
					callback();
				});
		  });

	vorpal
	  .command('spv <address>', 'Perform Simple Payment Verification against the blockchain')
	  .action(function(args, callback) {
			scope.db.query("select * from mem_accounts where address ='"+args.address+"'").then(function(rows){
				var publicKey=rows[0].publicKey.toString("hex");
				var receivedSQL='select sum(amount) as total, count(amount) as count from transactions where amount > 0 and "recipientId" = \''+args.address+'\';'
				var spentSQL='select sum(amount+fee) as total, count(amount) as count from transactions where "senderPublicKey" = \'\\x'+publicKey+'\';'
				var rewardsSQL='select sum(reward+"totalFee") as total, count(reward) as count from blocks where "generatorPublicKey" = \'\\x'+publicKey+'\';'
				async.series({
					received: function(cb){
						scope.db.query(receivedSQL).then(function(rows){
							cb(null, rows[0]);
						});
					},
					spent: function(cb){
						scope.db.query(spentSQL).then(function(rows){
							cb(null, rows[0]);
						});
					},
					rewards: function(cb){
						scope.db.query(rewardsSQL).then(function(rows){
							cb(null, rows[0]);
						});
					}
				}, function(err, result){
					result.balance = parseInt(result.received.total||0) - parseInt(result.spent.total||0) + parseInt(result.rewards.total||0);
					result.numberOfTransactions = parseInt(result.received.count||0) + parseInt(result.spent.count||0)
					result.forgedBlocks =parseInt(result.rewards.count||0);
					self.log(JSON.stringify(result));
				});
				callback();
			}).catch(function(error){
				self.log('Account not found '+args.address);
				callback();
			});
			var self = this;

	  });

	vorpal.history('ark-node');

	vorpal
	  .delimiter('ark-node>')
	  .show();
}
