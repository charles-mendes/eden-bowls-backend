const { EntitySchema } = require('typeorm');

function buildOnboardingUserStateEntitySchema(tableName = 'onboarding_user_state') {
  return new EntitySchema({
    name: 'OnboardingUserState',
    tableName,
    columns: {
      userId: {
        name: 'user_id',
        type: Number,
        primary: true
      },
      recurrence: {
        type: 'json',
        nullable: true
      },
      planSelection: {
        name: 'plan_selection',
        type: 'json',
        nullable: true
      },
      address: {
        type: 'json',
        nullable: true
      },
      shipping: {
        type: 'json',
        nullable: true
      },
      paymentReference: {
        name: 'payment_reference',
        type: 'json',
        nullable: true
      },
      checkoutReference: {
        name: 'checkout_reference',
        type: 'json',
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
  buildOnboardingUserStateEntitySchema
};