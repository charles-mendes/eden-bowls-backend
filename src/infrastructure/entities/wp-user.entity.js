const { EntitySchema } = require('typeorm');

function buildWpUserEntitySchema(tableName = 'wp_users') {
  return new EntitySchema({
    name: 'WpUser',
    tableName,
    columns: {
      id: {
        name: 'ID',
        type: Number,
        primary: true,
        generated: true
      },
      userLogin: {
        name: 'user_login',
        type: String,
        length: 60
      },
      userPass: {
        name: 'user_pass',
        type: String,
        length: 255
      },
      userNicename: {
        name: 'user_nicename',
        type: String,
        length: 50
      },
      userEmail: {
        name: 'user_email',
        type: String,
        length: 100
      },
      displayName: {
        name: 'display_name',
        type: String,
        length: 250
      }
    }
  });
}

module.exports = {
  buildWpUserEntitySchema
};
