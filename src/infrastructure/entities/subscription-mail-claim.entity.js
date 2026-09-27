const { EntitySchema } = require('typeorm');

function buildSubscriptionMailClaimEntitySchema(tableName = 'subscription_mail_claims') {
  return new EntitySchema({
    name: 'SubscriptionMailClaim',
    tableName,
    columns: {
      id: {
        type: 'bigint',
        unsigned: true,
        primary: true,
        generated: true
      },
      stripeSubscriptionId: {
        name: 'stripe_subscription_id',
        type: String,
        length: 64
      },
      template: {
        type: String,
        length: 64
      },
      referenceId: {
        name: 'reference_id',
        type: String,
        length: 191
      },
      claimedAt: {
        name: 'claimed_at',
        type: 'datetime',
        createDate: true
      },
      sentAt: {
        name: 'sent_at',
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
      exhaustedAt: {
        name: 'exhausted_at',
        type: 'datetime',
        nullable: true
      },
      payload: {
        type: 'json',
        nullable: true
      }
    },
    uniques: [
      {
        name: 'uniq_subscription_mail_claim',
        columns: ['stripeSubscriptionId', 'template', 'referenceId']
      }
    ]
  });
}

module.exports = {
  buildSubscriptionMailClaimEntitySchema
};
