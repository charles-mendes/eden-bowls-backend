const { EntitySchema } = require('typeorm');

function buildStripeWebhookEventEntitySchema(tableName = 'stripe_webhook_events') {
  return new EntitySchema({
    name: 'StripeWebhookEvent',
    tableName,
    columns: {
      eventId: {
        name: 'event_id',
        type: String,
        length: 64,
        primary: true
      },
      stripeAccount: {
        name: 'stripe_account',
        type: String,
        length: 8,
        primary: true,
        default: 'us'
      },
      type: {
        type: String,
        length: 64
      },
      processedAt: {
        name: 'processed_at',
        type: 'datetime',
        nullable: true
      },
      attempts: {
        type: 'int',
        default: 0
      },
      lastError: {
        name: 'last_error',
        type: String,
        length: 500,
        nullable: true
      },
      nextAttemptAt: {
        name: 'next_attempt_at',
        type: 'datetime',
        nullable: true
      },
      failedAt: {
        name: 'failed_at',
        type: 'datetime',
        nullable: true
      },
      createdAt: {
        name: 'created_at',
        type: 'datetime',
        createDate: true
      },
      payloadSummary: {
        name: 'payload_summary',
        type: 'json',
        nullable: true
      }
    }
  });
}

module.exports = {
  buildStripeWebhookEventEntitySchema
};
