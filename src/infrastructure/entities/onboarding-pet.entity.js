const { EntitySchema } = require('typeorm');

function buildOnboardingPetEntitySchema(tableName = 'onboarding_pets') {
  return new EntitySchema({
    name: 'OnboardingPet',
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
      localId: {
        name: 'local_id',
        type: String,
        length: 36,
        nullable: true
      },
      name: {
        type: String,
        length: 120
      },
      breed: {
        type: String,
        length: 120,
        default: "''"
      },
      ageYears: {
        name: 'age_years',
        type: Number,
        default: 0
      },
      ageMonths: {
        name: 'age_months',
        type: Number,
        default: 0
      },
      weightInput: {
        name: 'weight_input',
        type: 'decimal',
        precision: 10,
        scale: 2,
        default: 0
      },
      weightUnit: {
        name: 'weight_unit',
        type: String,
        length: 2
      },
      size: {
        type: String,
        length: 16,
        default: "''"
      },
      activityLevel: {
        name: 'activity_level',
        type: String,
        length: 16,
        default: "''"
      },
      petCondition: {
        name: 'pet_condition',
        type: String,
        length: 16,
        default: "''"
      },
      neutered: {
        type: Boolean,
        default: false
      },
      imageUrl: {
        name: 'image_url',
        type: String,
        length: 2048,
        nullable: true
      },
      deletedAt: {
        name: 'deleted_at',
        type: 'datetime',
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
  buildOnboardingPetEntitySchema
};