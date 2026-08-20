const { AdminNutritionService } = require('../src/services/admin-nutrition.service');
const { HttpError } = require('../src/core/http-error');

describe('AdminNutritionService', () => {
  const service = new AdminNutritionService();

  test('uses dog NEM 3600 and combination factor', () => {
    const result = service.simulate({
      country: 'US',
      pet: { type: 'dog', life_stage: 'adult', weight: 20, neutered: true, age: 4 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(result.data.nem_kcal_kg).toBe(3600);
    expect(result.data.fator_aplicado).toBe(85);
    expect(result.data.refeicoes).toBe(2);
    expect(result.data.display.weight).toContain('lb');
  });

  test('uses cat NEM 3800 instead of the old admin 3600 bug', () => {
    const result = service.simulate({
      country: 'BR',
      pet: { type: 'cat', life_stage: 'adult', weight: 4, neutered: true },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(result.data.nem_kcal_kg).toBe(3800);
    expect(result.data.especie).toBe('cat');
    expect(result.data.refeicoes).toBe(3);
    expect(result.data.display.daily).toContain('g/dia');
  });

  test('rejects invalid weight', () => {
    expect(() => service.simulate({
      country: 'US',
      pet: { type: 'dog', weight: 0 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    })).toThrow(HttpError);
  });
});
