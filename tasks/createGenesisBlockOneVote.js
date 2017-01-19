var moment = require('moment');
var fs = require('fs');
var path = require('path');
var arkjs = require('arkjs');
var crypto = require('crypto');
var bip39 = require('bip39');
var ByteBuffer = require('bytebuffer');
var bignum = require('../helpers/bignum.js');
var ed = require('../helpers/ed.js');


var config = {
    "port": 4000,
    "address": "0.0.0.0",
    "version": "0.1.0",
    "fileLogLevel": "info",
    "logFileName": "logs/ark.log",
    "consoleLogLevel": "debug",
    "trustProxy": false,
    "db": {
        "host": "localhost",
        "port": 5432,
        "database": "ark_test",
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
        "list": [{"ip":"127.0.0.1", "port":4000}],
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
    "nethash":"198f2b61a8eb95fbeed58b8216780b68f697f26b849acf00c8c93bb9b24f783d"
};




sign = function (block, keypair) {
	var hash = getHash(block);
	return ed.sign(hash, keypair).toString('hex');
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
  balance: 12500000000000000
};

var premine = {
  passphrase: bip39.generateMnemonic()
};

premine.publicKey = arkjs.crypto.getKeys(premine.passphrase).publicKey;
premine.address = arkjs.crypto.getAddress(premine.publicKey);

genesis.publicKey = arkjs.crypto.getKeys(genesis.passphrase).publicKey;
genesis.address = arkjs.crypto.getAddress(genesis.publicKey);




// We create vote transactions
// Each delegate vote for themselves with 1/51th of the total premined

for(var i=1; i<52; i++){
  var delegate = {
    'passphrase': bip39.generateMnemonic(),
    'username': "genesis_"+i
  };

	delegate.balance=245098000000000;
	// special case so all amounts add up to 12500000000000000
	if(i==1){
		delegate.balance=245100000000000;
	}

	delegate.publicKey = arkjs.crypto.getKeys(delegate.passphrase).publicKey;
	delegate.address = arkjs.crypto.getAddress(delegate.publicKey);

	//send ark to delegate
	var premineTx = arkjs.transaction.createTransaction(delegate.address, delegate.balance, null, premine.passphrase);

	premineTx.fee = 0;
	premineTx.timestamp = 0;
	premineTx.senderId = premine.address;
	premineTx.signature = arkjs.crypto.sign(premineTx,arkjs.crypto.getKeys(premine.passphrase));
	premineTx.id = arkjs.crypto.getId(premineTx);
	transactions.push(premineTx);


	// create delegate
  var createDelegateTx = arkjs.delegate.createDelegate(delegate.passphrase, delegate.username);
  createDelegateTx.fee = 0;
  createDelegateTx.timestamp = 0;
  createDelegateTx.senderId = delegate.address;
  createDelegateTx.signature = arkjs.crypto.sign(createDelegateTx,arkjs.crypto.getKeys(delegate.passphrase));
  createDelegateTx.id = arkjs.crypto.getId(createDelegateTx);

  transactions.push(createDelegateTx);

	//vote for itself
	var voteTransaction = arkjs.vote.createVote(delegate.passphrase,["+"+delegate.publicKey]);
	voteTransaction.fee = 0;
	voteTransaction.timestamp = 0;
	voteTransaction.senderId = delegate.address;
	voteTransaction.signature = arkjs.crypto.sign(voteTransaction,arkjs.crypto.getKeys(delegate.passphrase));
	voteTransaction.id = arkjs.crypto.getId(voteTransaction);

	transactions.push(voteTransaction);

	//push to list of delegates
  delegates.push(delegate);
}


var genesisBlock = create({
  keypair: arkjs.crypto.getKeys(genesis.passphrase),
  transactions:transactions,
  timestamp:0
});

for(var i=0;i<51;i++){
	config.forging.secret.push(delegates[i].passphrase);
}

config.nethash = genesisBlock.payloadHash;



fs.writeFile("tasks/genesisBlock.json",JSON.stringify(genesisBlock, null, 2));
fs.writeFile("tasks/config.json",JSON.stringify(config, null, 2));
fs.writeFile("tasks/delegatesPassphrases.json", JSON.stringify(delegates, null, 2));
fs.writeFile("tasks/genesisPassphrase.json", JSON.stringify(genesis, null, 2));
