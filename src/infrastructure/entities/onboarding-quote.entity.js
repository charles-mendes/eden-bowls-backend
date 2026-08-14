const { EntitySchema } = require('typeorm');

function buildOnboardingQuoteEntitySchema(tableName = 'onboarding_quotes') {
  return new EntitySchema({
    name: 'OnboardingQuote',
    tableName,
    columns: {
      id: { type: String, length: 64, primary: true },
      userId: { name: 'user_id', type: Number, nullable: true },
      payloadHash: { name: 'payload_hash', type: String, length: 64 },
      payload: { type: 'json' },
      pricing: { type: 'json' },
      status: { type: String, length: 16, default: "'active'" },
      expiresAt: { name: 'expires_at', type: 'datetime' },
      consumedAt: { name: 'consumed_at', type: 'datetime', nullable: true },
      createdAt: { name: 'created_at', type: 'datetime', createDate: true },
      updatedAt: { name: 'updated_at', type: 'datetime', updateDate: true }
    }
  });
}

module.exports = {
  buildOnboardingQuoteEntitySchema
};