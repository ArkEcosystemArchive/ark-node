"use strict";

var _ = require('lodash');
var popsicle = require('popsicle');
var schema = require('../schema/peers.js');
var __schemas = require('../schema/api.peer.js');
_.extend(__schemas, require('../schema/api.public.js'));

// Private fields
var modules, library;

var __headers;

//
//__API__ `bind`

//
Peer.bind = function (scope) {
	modules = scope.modules;
	library = scope.library;
  __headers = {
		os: modules.system.getOS(),
		version: modules.system.getVersion(),
		port: modules.system.getPort(),
		nethash: modules.system.getNethash()
	};
};

// single Peer object
function Peer(ip, port, version, os){
	this.ip = ip.trim();
	this.port = port;
	this.version = version;
	this.os = os;
	this.protocol = (port%1000)==443?"https":"http";
	this.liteclient = port < 80;
  this.websocketapi = false;
	this.status = "NEW";
	this.publicapi = false;
	this.blockheader;
	this.requests = 0;
	this.delay = 10000;
	this.lastchecked = 0;
	this.counterror = 0;
	this.banuntil = new Date().getTime();

  this.forgingAllowed = false;
	this.currentSlot = 0;

	if(!this.liteclient){
		this.startMonitoring();
	}
}

Peer.prototype.startMonitoring = function(){
	this.updateStatus();
	var that = this;
	if(!this.intervalId){
		this.counterror = 0;
		this.intervalId = setInterval(
			function(){
				if(new Date().getTime() - that.lastchecked > 60000){
					// basically a node down a few min is banned
					if(that.counterror > 10){
						that.stopMonitoring();
						// 6 hours ban
						that.ban(6*60);
					}
					else {
						that.updateStatus();
					}
				}
			}, 60000
		);
	}
};

Peer.prototype.stopMonitoring = function(){
	clearInterval(this.intervalId);
	this.intervalId = null;
}

Peer.prototype.ban = function(minutesToBan){
	this.banuntil = new Date().getTime() + minutesToBan*60*1000;
	library.logger.info(this + " banned for "+minutesToBan+" minutes");
};

Peer.prototype.unban = function(){
	if(this.banuntil < new Date().getTime() && !this.intervalId){
		this.startMonitoring();
	}
};

Peer.prototype.toObject = function(){
  return {
    ip: this.ip,
    port: this.port,
    version: this.version,
		errors: this.counterror,
    os: this.os,
    height: this.height,
    status: this.status,
    delay: this.delay
  };
};

Peer.prototype.toString = function(){
  return this.protocol+"://"+this.ip+":"+this.port;
};

Peer.prototype.normalizeHeader = function(header){
  var result = {
    port: parseInt(header.port),
    os: header.os,
    version: header.version,
    nethash: header.nethash
  };
  if(header.blockheader){
    result.blockheader = {
      id: header.blockheader.id,
      timestamp: header.blockheader.timestamp,
      signature: header.blockheader.signature,
      generatorPublicKey: header.blockheader.generatorPublicKey,
      version: header.blockheader.version,
      height: header.blockheader.height,
      numberOfTransactions: header.blockheader.numberOfTransactions,
      previousBlock: header.blockheader.previousBlock,
      totalAmount: header.blockheader.totalAmount,
      totalFee: header.blockheader.totalFee,
      reward: header.blockheader.reward,
      payloadLength: header.blockheader.payloadLength,
      payloadHash: header.blockheader.payloadHash
    };
		result.height= parseInt(header.blockheader.height);
  }
  return result;
};

Peer.prototype.updateStatus = function(){
  var that = this;
  this.fetchStatus();
  this.get('/api/blocks/getHeight', function(err, body){
    that.publicapi = !!err;
  });
};

Peer.prototype.fetchHeight = function(cb){
  this.get('/peer/height', cb);
}

Peer.prototype.fetchStatus = function(cb){
	var that = this;
  this.request('/peer/status', {method:'GET', timeout: 2000}, function(err, res){
		if(!err){
			that.height = res.body.height;
			that.blockheader = res.body.header;
			that.forgingAllowed = res.body.forgingAllowed;
			that.currentSlot = res.body.currentSlot;
			var check = {verified: false};
			try {
				check = modules.blocks.verifyBlockHeader(res.body.header);
			} catch (e) {
				check.errors = [e];
			}
			if(!check.verified){
				that.status="FORK";
				that.counterror++;
				console.log(res.body);
				library.logger.trace(that + " sent header", res.body.header);
				library.logger.debug(that + " header errors", check.errors);
				return cb && cb('Received invalid block header from peer '+that, res);
			}
			else {
				that.counterror = 0;
        that.status = "OK";
      }
		}
		else {
			that.counterror++;
		}
		return cb && cb(err, res);
	});
}

Peer.prototype.fetchPeers = function(cb){
  this.get('/peer/list', cb);
}

Peer.prototype.postTransactions = function(transactions, cb){
	this.post('/peer/transactions', {transactions: transactions}, cb);
}

Peer.prototype.getTransactionFromIds = function(transactionIds, cb){
	this.get('/peer/transactionsFromIds?ids='+transactionIds.join(","), cb);
}

Peer.prototype.accept = function(){
  this.lastchecked=new Date().getTime();
  return this;
};

Peer.prototype.get = function(api, cb){
  return this.request(api, {method:'GET'}, cb);
};

Peer.prototype.post = function(api, payload, cb){
  return this.request(api, {method:'POST', data:payload}, cb);
};

Peer.prototype.request = function(api, options, cb){
  var req = {
    url: this.protocol+'://' + this.ip + ':' + this.port + api,
    method: options.method,
    headers: _.extend({}, __headers, options.headers),
    timeout: options.timeout || library.config.peers.options.timeout
  };

  if (options.data) {
    req.body = options.data;
  }

  var request = popsicle.request(req);
  this.lastchecked=new Date().getTime();
  var that = this;
  request.use(popsicle.plugins.parse(['json'], false)).then(function (res) {
    that.delay=new Date().getTime()-that.lastchecked;
    if (res.status !== 200) {
      that.status="ERESPONSE";
			that.counterror++;
      return cb(['Received bad response code', res.status, req.method, req.url].join(' '));
    } else {

			// if there is a schema in options, validate the answer with this schema
			// otherwise try to grab the one predefined in __schemas
			var apihandle = api.split("?")[0];
			var report = true;
			var apischema = options.schema || __schemas[options.method +":"+apihandle];
			if(apischema){
				report = library.schema.validate(res.body, apischema);
			}
			else {
				library.logger.warn("No schema provided to validate answer for "+options.method +":"+apihandle);
			}

			if(!report){
				that.status = "EAPI";
				that.counterror++;
				library.logger.debug(options.method +":"+apihandle, res.body);
				return cb("Returned data does not match API requirement for " + options.method +":"+apihandle);
			}

      var header = that.normalizeHeader(res.headers);
			report = library.schema.validate(header, schema.headers);

      if (!report) {
        // no valid transport header, considering a public API call
        if(that.status!="FORK"){
          that.status = "OK";
        }
        return cb(null, {body: res.body, peer: that});
      }

      if(header.blockheader){
				that.blockheader = header.blockheader;
	      that.height = header.blockheader.height;
			}

      that.os = header.os;
      that.version = header.version;
      that.nethash = header.nethash;

      if(header.nethash !== library.config.nethash) {
        that.status="ENETHASH";
				that.counterror++;
        return cb(['Peer is not on the same network', header.nethash, req.method, req.url].join(' '));
      }

      if(that.status!="FORK"){
        that.status = "OK";
      }

      return cb(null, {body: res.body, peer: that});
    }
  })
  .catch(function (err) {
    if(err.code){
			that.status = err.code;
		}
		that.counterror++;
    return cb([err.code, 'Request failed', req.method, req.url].join(' '));
  });
};


// Export
module.exports = Peer;
