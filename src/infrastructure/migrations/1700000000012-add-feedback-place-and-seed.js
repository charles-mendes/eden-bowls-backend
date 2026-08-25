const { TableColumn } = require('typeorm');
const { seedDefaultFeedbacks } = require('./helpers/seed-feedbacks');

class AddFeedbackPlaceAndSeed1700000000012 {
  name = 'AddFeedbackPlaceAndSeed1700000000012';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('feedbacks'))) {
      return;
    }

    if (!(await queryRunner.hasColumn('feedbacks', 'place'))) {
      await queryRunner.addColumn('feedbacks', new TableColumn({
        name: 'place',
        type: 'varchar',
        length: '191',
        isNullable: false,
        default: "''"
      }));
    }

    await seedDefaultFeedbacks(queryRunner);
  }

  async down(queryRunner) {
    if (!(await queryRunner.hasTable('feedbacks'))) {
      return;
    }

    if (await queryRunner.hasColumn('feedbacks', 'place')) {
      await queryRunner.dropColumn('feedbacks', 'place');
    }
  }
}

module.exports = {
  AddFeedbackPlaceAndSeed1700000000012
};
