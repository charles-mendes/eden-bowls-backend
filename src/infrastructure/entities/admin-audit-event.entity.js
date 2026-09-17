const { EntitySchema } = require('typeorm');

function buildAdminAuditEventEntitySchema(tableName = 'admin_audit_events') {
  return new EntitySchema({
    name: 'AdminAuditEvent',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true,
        unsigned: true
      },
      actorUserId: {
        name: 'actor_user_id',
        type: Number,
        unsigned: true,
        nullable: true
      },
      actorEmail: {
        name: 'actor_email',
        type: String,
        length: 191,
        nullable: true
      },
      action: {
        type: String,
        length: 64
      },
      targetUserId: {
        name: 'target_user_id',
        type: Number,
        unsigned: true,
        nullable: true
      },
      targetEmail: {
        name: 'target_email',
        type: String,
        length: 191,
        nullable: true
      },
      metadata: {
        type: 'json',
        nullable: true
      },
      createdAt: {
        name: 'created_at',
        type: 'datetime',
        createDate: true
      }
    }
  });
}

module.exports = {
  buildAdminAuditEventEntitySchema
};
