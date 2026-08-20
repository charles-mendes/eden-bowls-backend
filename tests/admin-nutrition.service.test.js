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

  test('converts pound weight before calculating', () => {
    const inKg = service.simulate({
      country: 'US',
      pet: { type: 'dog', life_stage: 'adult', weight: 10, weight_unit: 'kg', neutered: true, age: 4 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });
    const inLb = service.simulate({
      country: 'US',
      pet: { type: 'dog', life_stage: 'adult', weight: 22.05, weight_unit: 'lb', neutered: true, age: 4 },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(inLb.data.quantidade_g_dia).toBe(inKg.data.quantidade_g_dia);
    expect(inLb.data.display.weight).toContain('lb');
  });

  test('accepts age in months for a puppy', () => {
    const result = service.simulate({
      country: 'BR',
      pet: {
        type: 'dog',
        life_stage: 'puppy',
        weight: 3,
        age: 0,
        age_years: 0,
        age_months: 2,
        neutered: false
      },
      questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
    });

    expect(result.data.especie).toBe('dog');
    expect(result.data.energia_kcal_dia).toBeGreaterThan(0);
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
