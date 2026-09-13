const { EntitySchema } = require('typeorm');

function buildPrivacyRequestEntitySchema(tableName = 'privacy_requests') {
  return new EntitySchema({
    name: 'PrivacyRequest',
    tableName,
    columns: {
      id: {
        type: Number,
        primary: true,
        generated: true,
        unsigned: true
      },
      userId: {
        name: 'user_id',
        type: Number,
        unsigned: true,
        nullable: true
      },
      type: {
        type: String,
        length: 32
      },
      status: {
        type: String,
        length: 32
      },
      locale: {
        type: String,
        length: 16,
        nullable: true
      },
      market: {
        type: String,
        length: 8
      },
      payload: {
        type: 'json',
        nullable: true
      },
      resultNote: {
        name: 'result_note',
        type: 'text',
        nullable: true
      },
      dueAt: {
        name: 'due_at',
        type: 'datetime',
        nullable: true
      },
      extendedAt: {
        name: 'extended_at',
        type: 'datetime',
        nullable: true
      },
      extensionReason: {
        name: 'extension_reason',
        type: String,
        length: 255,
        nullable: true
      },
      identityStatus: {
        name: 'identity_status',
        type: String,
        length: 32
      },
      identityVerifiedAt: {
        name: 'identity_verified_at',
        type: 'datetime',
        nullable: true
      },
      channel: {
        type: String,
        length: 16
      },
      resolvedAt: {
        name: 'resolved_at',
        type: 'datetime',
        nullable: true
      },
      resolvedBy: {
        name: 'resolved_by',
        type: Number,
        unsigned: true,
        nullable: true
      },
      createdAt: {
        name: 'created_at',
        type: 'datetime',
        createDate: true
      },
      updatedAt: {
        name: 'updated_at',
        type: 'datetime',
        updateDate: true
      }
    }
  });
}

module.exports = {
  buildPrivacyRequestEntitySchema
};
