'use strict';

var NodeManagerSql = {
  getTransactionId: 'SELECT "id" FROM transactions WHERE "id" = ${id}'
};

module.exports = NodeManagerSql;
