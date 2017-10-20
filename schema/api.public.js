'use strict';

module.exports = {
	'GET:/api/blocks/getHeight':{
		id: 'GET:/api/blocks/getHeight',
		type: 'object',
		properties: {
			success: {
				type: 'boolean'
			},
			height: {
				type: 'integer',
				minimum: 0
			}
		},
		required: ['success','height']
	}
};
