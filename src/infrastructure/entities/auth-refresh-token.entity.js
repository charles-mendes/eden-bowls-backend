const { EntitySchema } = require('typeorm');

function buildAuthRefreshTokenEntitySchema(tableName = 'auth_refresh_tokens') {
  return new EntitySchema({
    name: 'AuthRefreshToken',
    tableName,
    columns: {
      id: {
        type: String,
        length: 36,
        primary: true
      },
      userId: {
        name: 'user_id',
        type: Number
      },
      familyId: {
        name: 'family_id',
        type: String,
        length: 36
      },
      tokenHash: {
        name: 'token_hash',
        type: String,
        length: 64,
        unique: true
      },
      replacedById: {
        name: 'replaced_by_id',
        type: String,
        length: 36,
        nullable: true
      },
      replayGraceUntil: {
        name: 'replay_grace_until',
        type: 'datetime',
        nullable: true
      },
      replayConsumedAt: {
        name: 'replay_consumed_at',
        type: 'datetime',
        nullable: true
      },
      expiresAt: {
        name: 'expires_at',
        type: 'datetime'
      },
      lastUsedAt: {
        name: 'last_used_at',
        type: 'datetime',
        nullable: true
      },
      revokedAt: {
        name: 'revoked_at',
        type: 'datetime',
        nullable: true
      },
      revokedReason: {
        name: 'revoked_reason',
        type: String,
        length: 64,
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
  buildAuthRefreshTokenEntitySchema
};