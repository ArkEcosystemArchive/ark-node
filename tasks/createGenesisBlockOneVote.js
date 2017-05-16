var moment = require('moment');
var fs = require('fs');
var path = require('path');
var arkjs = require('arkjs');
var crypto = require('crypto');
var bip39 = require('bip39');
var ByteBuffer = require('bytebuffer');
var bignum = require('../helpers/bignum.js');
var Crypto = require('../helpers/crypto.js');
var networks = require('../networks.json');

var genesisAccounts = JSON.parse(fs.readFileSync('./tasks/genesis.testnet.accounts.json'));
var remainingfund = {};
var totalpremine = 12500000000000000;



var config = {
    "port": 4002,
    "address": "0.0.0.0",
    "version": "1.1.0",
    "fileLogLevel": "info",
    "logFileName": "logs/ark.log",
    "consoleLogLevel": "debug",
    "trustProxy": false,
    "db": {
        "host": "localhost",
        "port": 5432,
        "database": "ark_devnet",
        "user": null,
        "password": "password",
        "poolSize": 20,
        "poolIdleTimeout": 30000,
        "reapIntervalMillis": 1000,
        "logEvents": [
            "error"
        ]
    },
    "api": {
        "mount":true,
        "access": {
            "whiteList": []
        },
        "options": {
            "limits": {
                "max": 0,
                "delayMs": 0,
                "delayAfter": 0,
                "windowMs": 60000
            }
        }
    },
    "peers": {
        "minimumNetworkReach":1,
        "list": [{"ip":"127.0.0.1", "port":4002}],
        "blackList": [],
        "options": {
            "limits": {
                "max": 0,
                "delayMs": 0,
                "delayAfter": 0,
                "windowMs": 60000
            },
            "maxUpdatePeers": 20,
            "timeout": 5000
        }
    },
    "forging": {
        "coldstart": 6,
        "force": true,
        "secret": [],
        "access": {
            "whiteList": [
                "127.0.0.1"
            ]
        }
    },
    "loading": {
        "verifyOnLoading": false,
        "loadPerIteration": 5000
    },
    "ssl": {
        "enabled": false,
        "options": {
            "port": 443,
            "address": "0.0.0.0",
            "key": "./ssl/ark.key",
            "cert": "./ssl/ark.crt"
        }
    },
    "network":"devnet",
    "nethash":"placeholder"
};

makeKeypair = function (seed) {
	return arkjs.crypto.getKeys(seed, networks[config.network]);
};

sign = function (block, keypair) {
	var hash = getHash(block);
	return keypair.sign(hash).toDER().toString("hex");
};


getId = function (block) {
	var hash = crypto.createHash('sha256').update(getBytes(block)).digest();
	var temp = new Buffer(8);
	for (var i = 0; i < 8; i++) {
		temp[i] = hash[7 - i];
	}

	var id = bignum.fromBuffer(temp).toString();
	return id;
};

getHash = function (block) {
	return crypto.createHash('sha256').update(getBytes(block)).digest();
};


getBytes = function (block) {
	var size = 4 + 4 + 4 + 8 + 4 + 4 + 8 + 8 + 4 + 4 + 4 + 32 + 32 + 64;
	var b, i;

	try {
		var bb = new ByteBuffer(size, true);
		bb.writeInt(block.version);
		bb.writeInt(block.timestamp);
    bb.writeInt(block.height);

		if (block.previousBlock) {
			var pb = bignum(block.previousBlock).toBuffer({size: '8'});

			for (i = 0; i < 8; i++) {
				bb.writeByte(pb[i]);
			}
		} else {
			for (i = 0; i < 8; i++) {
				bb.writeByte(0);
			}
		}

		bb.writeInt(block.numberOfTransactions);
		bb.writeLong(block.totalAmount);
		bb.writeLong(block.totalFee);
		bb.writeLong(block.reward);

		bb.writeInt(block.payloadLength);

		var payloadHashBuffer = new Buffer(block.payloadHash, 'hex');
		for (i = 0; i < payloadHashBuffer.length; i++) {
			bb.writeByte(payloadHashBuffer[i]);
		}

		var generatorPublicKeyBuffer = new Buffer(block.generatorPublicKey, 'hex');
		for (i = 0; i < generatorPublicKeyBuffer.length; i++) {
			bb.writeByte(generatorPublicKeyBuffer[i]);
		}

		if (block.blockSignature) {
			var blockSignatureBuffer = new Buffer(block.blockSignature, 'hex');
			for (i = 0; i < blockSignatureBuffer.length; i++) {
				bb.writeByte(blockSignatureBuffer[i]);
			}
		}

		bb.flip();
		b = bb.toBuffer();
	} catch (e) {
		throw e;
	}

	return b;
};

create = function (data) {
	var transactions = data.transactions.sort(function compare(a, b) {
		if (a.type < b.type) { return -1; }
		if (a.type > b.type) { return 1; }
		if (a.amount < b.amount) { return -1; }
		if (a.amount > b.amount) { return 1; }
		return 0;
	});

	var nextHeight = 1;

	var reward = 0,
	    totalFee = 0, totalAmount = 0, size = 0;

	var blockTransactions = [];
	var payloadHash = crypto.createHash('sha256');

	for (var i = 0; i < transactions.length; i++) {
		var transaction = transactions[i];
		var bytes = arkjs.crypto.getBytes(transaction);

		size += bytes.length;

		totalFee += transaction.fee;
		totalAmount += transaction.amount;

		blockTransactions.push(transaction);
		payloadHash.update(bytes);
	}

	var block = {
		version: 0,
		totalAmount: totalAmount,
		totalFee: totalFee,
		reward: reward,
		payloadHash: payloadHash.digest().toString('hex'),
		timestamp: data.timestamp,
		numberOfTransactions: blockTransactions.length,
		payloadLength: size,
		previousBlock: null,
		generatorPublicKey: data.keypair.publicKey.toString('hex'),
		transactions: blockTransactions,
    height:1
	};

  block.id=getId(block);

	try {
		block.blockSignature = sign(block, data.keypair);
	} catch (e) {
		throw e;
	}

	return block;
}

var delegates = [];
var transactions = [];

var genesis = {
  passphrase: bip39.generateMnemonic(),
  balance: totalpremine
};

var premine = {
  passphrase: bip39.generateMnemonic()
};

premine.publicKey = arkjs.crypto.getKeys(premine.passphrase).publicKey;
premine.address = arkjs.crypto.getAddress(premine.publicKey, networks[config.network].pubKeyHash);

genesis.publicKey = arkjs.crypto.getKeys(genesis.passphrase).publicKey;
genesis.address = arkjs.crypto.getAddress(genesis.publicKey, networks[config.network].pubKeyHash);




// We create vote transactions
// Each delegate vote for themselves with 1/51th of the total premined

for(var i=1; i<52; i++){
  var delegate = {
    'passphrase': bip39.generateMnemonic(),
    'username': "genesis_"+i
  };

	delegate.balance=0;

	delegate.publicKey = arkjs.crypto.getKeys(delegate.passphrase).publicKey;
	delegate.address = arkjs.crypto.getAddress(delegate.publicKey, networks[config.network].pubKeyHash);

	//send ark to delegate
	var premineTx = arkjs.transaction.createTransaction(delegate.address, delegate.balance, null, premine.passphrase);

	premineTx.fee = 0;
	premineTx.timestamp = 0;
	premineTx.senderId = premine.address;
	premineTx.signature = arkjs.crypto.sign(premineTx,arkjs.crypto.getKeys(premine.passphrase));
	premineTx.id = arkjs.crypto.getId(premineTx);
	//transactions.push(premineTx);


	// create delegate
  var createDelegateTx = arkjs.delegate.createDelegate(delegate.passphrase, delegate.username);
  createDelegateTx.fee = 0;
  createDelegateTx.timestamp = 0;
  createDelegateTx.senderId = delegate.address;
  createDelegateTx.signature = arkjs.crypto.sign(createDelegateTx,arkjs.crypto.getKeys(delegate.passphrase));
  createDelegateTx.id = arkjs.crypto.getId(createDelegateTx);

  transactions.push(createDelegateTx);
  //
	// //vote for itself
	// var voteTransaction = arkjs.vote.createVote(delegate.passphrase,["+"+delegate.publicKey]);
	// voteTransaction.fee = 0;
	// voteTransaction.timestamp = 0;
	// voteTransaction.senderId = delegate.address;
	// voteTransaction.signature = arkjs.crypto.sign(voteTransaction,arkjs.crypto.getKeys(delegate.passphrase));
	// voteTransaction.id = arkjs.crypto.getId(voteTransaction);
  //
	// transactions.push(voteTransaction);

	//push to list of delegates
  delegates.push(delegate);
}

var total = 0;
console.log(genesisAccounts.reduce(function(memo, tx){
  return memo+tx.total;
},0));
for(var i=0; i < genesisAccounts.length; i++){
  var account = genesisAccounts[i];
  total += account.total;

	//send ark to account
	var premineTx = arkjs.transaction.createTransaction(account.address, account.total, null, premine.passphrase);

	premineTx.fee = 0;
	premineTx.timestamp = 0;
	premineTx.senderId = premine.address;
	premineTx.signature = arkjs.crypto.sign(premineTx,arkjs.crypto.getKeys(premine.passphrase));
	premineTx.id = arkjs.crypto.getId(premineTx);
	transactions.push(premineTx);

}

console.log(total);

remainingfund.total=totalpremine-total;
console.log(total);
console.log(remainingfund);

var preminefund = arkjs.transaction.createTransaction(genesis.address, remainingfund.total, null, premine.passphrase);

preminefund.fee = 0;
preminefund.timestamp = 0;
preminefund.senderId = premine.address;
preminefund.signature = arkjs.crypto.sign(preminefund,arkjs.crypto.getKeys(premine.passphrase));
preminefund.id = arkjs.crypto.getId(preminefund);
transactions.push(preminefund);

var genesisBlock = create({
  keypair: arkjs.crypto.getKeys(genesis.passphrase, networks[config.network]),
  transactions:transactions,
  timestamp:0
});

var checkup = genesisBlock.transactions.reduce(function(memo, tx){
  return memo+tx.amount;
},0);

console.log(checkup);

for(var i=0;i<51;i++){
	config.forging.secret.push(delegates[i].passphrase);
}

config.nethash = genesisBlock.payloadHash;

fs.writeFile("genesisBlock."+config.network+".json",JSON.stringify(genesisBlock, null, 2));
fs.writeFile("config."+config.network+".json",JSON.stringify(config, null, 2));
fs.writeFile("private/delegatesPassphrases."+config.network+".json", JSON.stringify(delegates, null, 2));
fs.writeFile("private/genesisPassphrase."+config.network+".json", JSON.stringify(genesis, null, 2));
