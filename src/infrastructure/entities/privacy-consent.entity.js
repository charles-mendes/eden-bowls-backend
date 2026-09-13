const { EntitySchema } = require('typeorm');

function buildPrivacyConsentEntitySchema(tableName = 'privacy_consents') {
  return new EntitySchema({
    name: 'PrivacyConsent',
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
      consentType: {
        name: 'consent_type',
        type: String,
        length: 32
      },
      status: {
        type: String,
        length: 32
      },
      documentVersion: {
        name: 'document_version',
        type: String,
        length: 32,
        nullable: true
      },
      source: {
        type: String,
        length: 32
      },
      ipHash: {
        name: 'ip_hash',
        type: String,
        length: 64,
        nullable: true
      },
      userAgent: {
        name: 'user_agent',
        type: String,
        length: 255,
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
  buildPrivacyConsentEntitySchema
};
