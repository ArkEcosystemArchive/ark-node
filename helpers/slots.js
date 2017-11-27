'use strict';

var constants = require('./constants.js');

/**
 * @returns {Date}
 */
function beginEpochTime () {
	var d = constants.epochTime;

	return d;
}

/**
 * Get time from Ark epoch.
 *
 * @param {number} [time=] Time in UNIX seconds
 * @returns {number}
 */
function getEpochTime (time) {
	if (time === undefined) {
		time = (new Date()).getTime();
	}

	var d = beginEpochTime();
	var t = d.getTime();

	return Math.floor((time - t) / 1000);
}

module.exports = {
	/** @type {number} */
	interval: constants.blocktime,
	/** @type {number} */
	delegates: constants.activeDelegates,

	/**
	 * @param {number} [time=] Time in UNIX seconds
	 * @returns {number}
	 */
	getTime: function (time) {
		return getEpochTime(time);
	},

	/**
	 * @param {number} [epochTime=]
	 * @returns {number}
	 */
	getRealTime: function (epochTime) {
		if (epochTime === undefined) {
			epochTime = this.getTime();
		}

		var d = beginEpochTime();
		var t = Math.floor(d.getTime() / 1000) * 1000;

		return t + epochTime * 1000;
	},

	/**
	 * @param {number} [epochTime=]
	 * @returns {number}
	 */
	getSlotNumber: function (epochTime) {
		if (epochTime === undefined) {
			epochTime = this.getTime();
		}

		return Math.floor(epochTime / this.interval);
	},

	/**
	 * Forging is allowed only during the first half of blocktime.
	 *
	 * @param {number} [epochTime=]
	 * @returns {boolean}
	 */
	isForgingAllowed: function (epochTime) {
		if (epochTime === undefined) {
			epochTime = this.getTime();
		}

		return Math.floor(epochTime / this.interval) == Math.floor((epochTime + this.interval / 2) / this.interval);
	},

	/**
	 * @param {number} slot
	 * @returns {number}
	 */
	getSlotTime: function (slot) {
		return slot * this.interval;
	},

	/**
	 * @returns {number}
	 */
	getNextSlot: function () {
		var slot = this.getSlotNumber();

		return slot + 1;
	},

	/**
	 * @param {number} nextSlot
	 * @returns {number}
	 */
	getLastSlot: function (nextSlot) {
		return nextSlot + this.delegates;
	},

	/**
	 * @param {Date} date
	 * @returns {number}
	 */
	roundTime: function (date) {
		return Math.floor(date.getTime() / 1000) * 1000;
	}
};
