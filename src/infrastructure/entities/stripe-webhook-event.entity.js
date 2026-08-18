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
      type: {
        type: String,
        length: 64
      },
      processedAt: {
        name: 'processed_at',
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
