const { EntitySchema } = require('typeorm');

function buildWpUserMetaEntitySchema(tableName = 'wp_usermeta') {
  return new EntitySchema({
    name: 'WpUserMeta',
    tableName,
    columns: {
      umetaId: {
        name: 'umeta_id',
        type: Number,
        primary: true,
        generated: true
      },
      userId: {
        name: 'user_id',
        type: Number
      },
      metaKey: {
        name: 'meta_key',
        type: String,
        length: 255,
        nullable: true
      },
      metaValue: {
        name: 'meta_value',
        type: 'text',
        nullable: true
      }
    }
  });
}

module.exports = {
  buildWpUserMetaEntitySchema
};
