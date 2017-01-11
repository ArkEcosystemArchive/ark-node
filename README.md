# Ark

Ark is a next generation crypto-currency and decentralized application platform, written entirely in JavaScript. For more information please refer to our website: https://ark.io/.

The Token Exchange Campaign is up at https://tec.ark.io

This version is still alpha, use at your own risks

## Details

This is a fork from Lisk with the following features:
- Removed sidechains
- Removed custom node version
- Removed UI for stability and security reasons
- Changed some constants (block rewards, blocktime etc...)
- Added simple PBFT before forging new block
- Ditch addresses from the protocol in favor of bitcoin like system, enabling HD Wallet
- Added 64 bytes vendorField as first iteration of smart bridge
- Made peers management entirely in-memory for efficiency
- Strengthened the transaction management and broadcast (reject often, reject soon)
- Rearchitect with relay nodes and forging nodes, relay nodes broadcasting only block headers (still ongoing).

Planned features:
- Add IPFS as first class citizen (using smartbridge addressing)
- Protocol improvements (uncle forging, voting weights).
- Remove unsecured API
- Routing tables


## Installation

**NOTE:** The following is applicable to: **Ubuntu 14.04 (LTS) - x86_64**.

Install essentials:

```
sudo apt-get update
sudo apt-get install -y curl build-essential python git
```

Install PostgreSQL (min version: 9.5.2)

```
sudo apt-get install -y postgresql postgresql-contrib
sudo -u postgres createuser --createdb --password $USER
createdb ark_test
```

Install Node.js (tested with version 6.9.2, but any recent should do):

```
sudo apt-get install -y nodejs
sudo npm install -g n
sudo n 6.9.2
```

Install grunt-cli (globally):

```
sudo npm install grunt-cli -g
```

Clone this repository
```
git clone https://github.com/arkecosytem/ark-node.git
cd ark-node
```

Install node modules:
```
npm install
```

Optionally if you want to perform tests, load git submodule [ark-js](https://github.com/arkecosystem/ark-js):
```
git submodule init
git submodule update
```

## Launch
To launch Ark on official testnet:
```
createdb ark_testnet
node run start:testnet
```
To launch Ark on official mainnet (when launched):
```
createdb ark_mainnet
node run start:mainnet
```

**NOTE:** The **port**, **address**, **genesis block** and **config-path** can be overridden by providing the relevant command switch:
```
node app.js -p [port] -a [address] -c [config-path] -g [genesisBlock-path]
```
This allow you to run several different networks, or your own private chain


## Launch your own private or public chain
Generate a genesisBlock.json + a default config.json containing all passphrases of genesis delegates
```
node tasks/createGenesisBlock.js
```
You can find generated files in tasks/
- genesisBlock.json
- config.json
- delegatesPassphrases.json (containing details about the genesis delegates)
- genesisPassphrase.json (containing the details of account having all premined arks)

Obviously you can hack away tasks/createGenesisBlock.js for your own custom use.

You can the start with your own chain on a single node (all delegates will forge on your single node) using:
```
createdb ark_newtest
npm run start:newtest
```

Then you can distribute the config.json (without the delegates secrets inside, and with custom peers settings) to peers to let them join your chain


## Tests
You should run using test configurations

```
npm run start:test
```

Run the test suite:

```
npm test
```

Run individual tests:

```
npm test -- test/api/accounts.js
npm test -- test/api/transactions.js
```

**NOTE:** The master passphrase for this test genesis block is as follows:

```
peace vanish bleak box tuna woman rally manage undo royal lucky since
```


## Authors
- FX Thoorens <fx.thoorens@ark.io>
- Boris Povod <boris@crypti.me>
- Pavel Nekrasov <landgraf.paul@gmail.com>
- Sebastian Stupurac <stupurac.sebastian@gmail.com>
- Oliver Beddows <oliver@lisk.io>

## License

The MIT License (MIT)

Copyright (c) 2016 Ark
Copyright (c) 2016 Lisk
Copyright (c) 2014-2015 Crypti

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:  

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
