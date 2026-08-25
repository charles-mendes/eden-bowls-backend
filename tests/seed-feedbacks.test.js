const { seedDefaultFeedbacks, DEFAULT_FEEDBACKS } = require('../src/infrastructure/migrations/helpers/seed-feedbacks');
const { AddFeedbackPlaceAndSeed1700000000012 } = require('../src/infrastructure/migrations/1700000000012-add-feedback-place-and-seed');

describe('seedDefaultFeedbacks', () => {
  test('inserts Sarah M. and James T. for BR and US when missing', async () => {
    const queryRunner = {
      query: jest.fn().mockResolvedValue([])
    };

    await seedDefaultFeedbacks(queryRunner);

    const inserts = queryRunner.query.mock.calls.filter((call) => String(call[0]).startsWith('INSERT'));
    expect(inserts).toHaveLength(4);
    expect(inserts.map((call) => call[1].slice(0, 4))).toEqual(
      DEFAULT_FEEDBACKS.map((item) => [item.name, item.category, item.country, item.place])
    );
  });

  test('fills empty place on an existing row instead of duplicating', async () => {
    const queryRunner = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 7, place: '' }])
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue([])
    };

    await seedDefaultFeedbacks(queryRunner);

    expect(queryRunner.query.mock.calls[1][0]).toContain('UPDATE `feedbacks` SET `place` = ?');
    expect(queryRunner.query.mock.calls[1][1]).toEqual(['Nova York', 7]);
    expect(queryRunner.query.mock.calls.filter((call) => String(call[0]).includes('INSERT'))).toHaveLength(3);
  });
});

describe('AddFeedbackPlaceAndSeed1700000000012', () => {
  test('adds the place column and seeds defaults', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(false),
      addColumn: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([])
    };

    await new AddFeedbackPlaceAndSeed1700000000012().up(queryRunner);

    expect(queryRunner.addColumn).toHaveBeenCalledWith('feedbacks', expect.objectContaining({
      name: 'place'
    }));
    expect(queryRunner.query.mock.calls.some((call) => String(call[0]).startsWith('INSERT'))).toBe(true);
  });
});
