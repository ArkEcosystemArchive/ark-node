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
- Ditch addresses from the protocol in favor of publicKeys to prevent from collisions, using base58 check (similar to bitcoin)
- Added vendorField as first iteration of smart bridge
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

Clone this repository
```
git clone https://bitbucket.com/arkio/ark-node.git
cd ark-node
```

Install PostgreSQL (version 9.5.2)

```
sudo apt-get install -y postgresql postgresql-contrib
sudo -u postgres createuser --createdb --password $USER
createdb ark_test
```

Install Node.js (version 0.12.x) + npm:

```
curl -sL https://deb.nodesource.com/setup_0.12 | sudo -E bash -
sudo apt-get install -y nodejs
```

Install grunt-cli (globally):

```
sudo npm install grunt-cli -g
```

Install node modules:

```
npm install
```

Load git submodule [ark-js](PLACEHOLDER):

```
git submodule init
git submodule update
```

## Launch

To launch Ark:

```
node app.js
```

**NOTE:** The **port**, **address** and **config-path** can be overridden by providing the relevant command switch:

```
node app.js -p [port] -a [address] -c [config-path]
```

## Tests

Before running any tests, please ensure Ark is configured to run on the same testnet as used by the test-suite.

Replace **config.json** and **genesisBlock.json** with the corresponding files under the **test** directory:

```
cp test/config.json test/genesisBlock.json .
```

**NOTE:** The master passphrase for this genesis block is as follows:

```
wagon stock borrow episode laundry kitten salute link globe zero feed marble
```

Launch ark (runs on port 4000):

```
node app.js
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

## Authors
- FX Thoorens <fx@ark.io>
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
