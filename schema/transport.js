'use strict';

module.exports = {
	headers: {
		id: 'transport.headers',
		type: 'object',
		properties: {
			ip: {
				type: 'string',
				format: 'ip'
			},
			port: {
				type: 'integer',
				minimum: 1,
				maximum: 65535
			},
			os: {
				type: 'string',
				maxLength: 64
			},
			nethash: {
				type: 'string',
				maxLength: 64
			},
			version: {
				type: 'string',
				maxLength: 11
			}
		},
		required: ['ip', 'port', 'nethash', 'version']
	},
	commonBlock: {
		id: 'transport.commonBlock',
		type: 'object',
		properties: {
			ids: {
				type: 'string',
				format: 'csv'
			}
		},
		required: ['ids']
	},
	transactionsFromIds: {
		id: 'transport.transactionsFromIds',
		type: 'object',
		properties: {
			ids: {
				type: 'string',
				format: 'csv'
			}
		},
		required: ['ids']
	},
	blocks: {
		id: 'transport.blocks',
		type: 'object',
		properties: {
			lastBlockHeight: {
				type: 'integer'
			}
		},
	},
	block: {
		id: 'transport.block',
		type: 'object',
		properties: {
			id: {
				type: 'string'
			}
		},
	},
	signatures: {
		id: 'transport.signatures',
		type: 'object',
		properties: {
			signature: {
				type: 'object',
				properties: {
					transaction: {
						type: 'string'
					},
					signature: {
						type: 'string',
						format: 'signature'
					}
				},
				required: ['transaction', 'signature']
			}
		},
		required: ['signature']
	}
};
