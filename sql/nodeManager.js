'use strict';

var NodeManagerSql = {
  getTransactionId: 'SELECT "id" FROM trs WHERE "id" = ${id}'
};

module.exports = NodeManagerSql;
