'use strict';

module.exports = {
	'GET:/peer/status':{
		id: 'GET:/peer/status',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			height: {
				type: 'integer',
				minimum: 0
			},
			currentSlot: {
				type: 'integer',
				minimum: 0
			},
			forgingAllowed: {
				type: 'boolean'
			},
			header: {
				type: 'object'
			}
		},
		required: ['success','height','header','currentSlot','forgingAllowed']
	},
	'GET:/peer/height':{
		id: 'GET:/peer/height',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			height: {
				type: 'integer',
				minimum: 0
			},
			header: {
				type: 'object'
			}
		},
		required: ['success','height','header']
	},
	'POST:/peer/transactions':{
		id: 'POST:/peer/transactions',
		type: 'object'
	},
	'GET:/peer/transactions':{
		id: 'GET:/peer/transactions',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			transactions: {
				type: 'array',
				uniqueItems: true
			}
		},
		required: ['transactions']
	},
	'GET:/peer/transactionsFromIds':{
		id: 'POST:/peer/transactionsFromIds',
		type: 'object'
	},
	'GET:/peer/blocks':{
		id: 'GET:/peer/blocks',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			blocks: {
				type: 'array'
			},
		},
		required: ['blocks']
	},
	'POST:/peer/blocks':{
		id: 'POST:/peer/blocks',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			blockId: {
				type: 'string'
			},
		},
		required: ['success', 'blockId']
	},
	'GET:/peer/block':{
		id: 'GET:/peer/block',
		type: 'object'
	},
	'GET:/peer/blocks/common':{
		id: 'GET:/peer/blocks/common',
		type: 'object'
	},
	'GET:/peer/list':{
		id: 'GET:/peer/list',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			peers: {
				type: 'array'
			},
		},
		required: ['peers']
	}
};
