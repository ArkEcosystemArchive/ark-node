'use strict';

var constants = require('../helpers/constants.js');

// Private fields
var __private = {};

// Constructor
function BlockReward () {
	// Array of milestones
	this.milestones = constants.rewards.milestones;

	// Distance between each milestone
	this.distance = Math.floor(constants.rewards.distance);

	// Start rewards at block (n)
	this.rewardOffset = Math.floor(constants.rewards.offset);
}

// Private methods
__private.parseHeight = function (height) {
	if (isNaN(height)) {
		throw 'Invalid block height';
	} else {
		return Math.abs(height);
	}
};

// Public methods
//
//__API__ `calcMilestone`

//
BlockReward.prototype.calcMilestone = function (height) {
	var location = Math.trunc((__private.parseHeight(height) - this.rewardOffset) / this.distance);
	var lastMile = this.milestones[this.milestones.length - 1];

	if (location > (this.milestones.length - 1)) {
		return this.milestones.lastIndexOf(lastMile);
	} else {
		return location;
	}
};

//
//__API__ `calcReward`

//
BlockReward.prototype.calcReward = function (height) {
	height = __private.parseHeight(height);

	if (height < this.rewardOffset) {
		return 0;
	} else {
		return this.milestones[this.calcMilestone(height)];
	}
};

//
//__API__ `calcSupply`

//
BlockReward.prototype.calcSupply = function (height) {
	return constants.totalAmount + ((__private.parseHeight(height) - constants.rewards.offset) * Math.pow(10, 8)) * 2;
};

// Export
module.exports = BlockReward;
