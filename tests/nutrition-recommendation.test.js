const { COMBINATION_FACTORS, buildForPet, calculateFood } = require('../src/core/nutrition-recommendation');

describe('nutrition recommendation', () => {
  test.each(Object.entries(COMBINATION_FACTORS))('applies combination factor %s = %s', (key, expectedFactor) => {
    const [castrado, atividade, score] = key.split('-');
    const result = calculateFood({
      especie: 'cao',
      peso: 20,
      castrado,
      nivel_atividade: atividade,
      score_corporal: score,
      estado_fisiologico: 'manutencao',
      nem_kcal_kg: 3600
    });

    expect(result.fator_aplicado).toBe(expectedFactor);
    expect(result.decision_trace.join('|')).toContain(`combination_override:${key}:${expectedFactor}`);
  });

  test('combination overrides state and base factors', () => {
    const result = calculateFood({
      especie: 'cao',
      peso: 12,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ACIMA',
      estado_fisiologico: 'gestante',
      nem_kcal_kg: 3600
    });

    expect(result.fator_aplicado).toBe(75);
    expect(result.decision_trace.join('|')).toContain('state_override:GESTANTE:132');
    expect(result.decision_trace.join('|')).toContain('combination_override:SIM-BAIXO-ACIMA:75');
  });

  test('uses weight to the power of 0.75 for daily energy', () => {
    const weight = 30;
    const result = calculateFood({
      especie: 'cao',
      peso: weight,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ACIMA',
      nem_kcal_kg: 3600
    });

    expect(result.energia_kcal_dia).toBe(Math.round(75 * (weight ** 0.75)));
  });

  test('distributes meals for adult dog, growing dog and cat', () => {
    const dogAdult = calculateFood({
      especie: 'cao',
      peso: 18,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ADEQUADO',
      estado_fisiologico: 'manutencao'
    });
    const dogGrowth = calculateFood({
      especie: 'cao',
      peso: 8,
      castrado: 'NAO',
      nivel_atividade: 'MODERADO',
      score_corporal: 'ADEQUADO',
      estado_fisiologico: 'crescimento'
    });
    const cat = calculateFood({
      especie: 'gato',
      peso: 4,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ADEQUADO',
      estado_fisiologico: 'manutencao'
    });

    expect(dogAdult.refeicoes).toBe(2);
    expect(dogGrowth.refeicoes).toBe(3);
    expect(cat.refeicoes).toBe(3);
  });

  test('classifies dog size by weight', () => {
    const sizes = [
      [5, 'mini'],
      [9, 'pequeno'],
      [20, 'medio'],
      [35, 'grande'],
      [45, 'gigante']
    ];

    for (const [peso, porte] of sizes) {
      const result = calculateFood({
        especie: 'cao',
        peso,
        castrado: 'SIM',
        nivel_atividade: 'BAIXO',
        score_corporal: 'ADEQUADO'
      });
      expect(result.porte).toBe(porte);
    }
  });

  test('uses NEM from input then species default', () => {
    const withInput = calculateFood({
      especie: 'cao',
      peso: 20,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ADEQUADO',
      nem_kcal_kg: 4100
    });
    const dogDefault = calculateFood({
      especie: 'cao',
      peso: 20,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ADEQUADO'
    });
    const catDefault = calculateFood({
      especie: 'gato',
      peso: 4,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ADEQUADO'
    });

    expect(withInput.nem_kcal_kg).toBe(4100);
    expect(dogDefault.nem_kcal_kg).toBe(3600);
    expect(catDefault.nem_kcal_kg).toBe(3800);
  });

  test('returns an error for invalid weight', () => {
    const result = calculateFood({
      especie: 'cao',
      peso: 0,
      castrado: 'SIM',
      nivel_atividade: 'BAIXO',
      score_corporal: 'ADEQUADO'
    });

    expect(result.error).toBeDefined();
  });

  test('maps English activity and body condition from the pet record', () => {
    const result = buildForPet({
      id: 'pet-1',
      name: 'Luna',
      weight_input: 10,
      weight_unit: 'kg',
      activity_level: 'medium',
      pet_condition: 'ideal',
      neutered: true
    });

    expect(result.pet_id).toBe('pet-1');
    expect(result.pet_name).toBe('Luna');
    expect(result.fator_aplicado).toBe(85);
    expect(result.quantidade_g_dia).toBe(Math.round((85 * (10 ** 0.75) / 3600) * 1000));
  });

  test('converts pound weight to kilograms before calculating', () => {
    const inKg = buildForPet({
      id: 'pet-kg',
      name: 'Milo',
      weight_input: 10,
      weight_unit: 'kg',
      activity_level: 'low',
      pet_condition: 'overweight',
      neutered: true
    });
    const inLb = buildForPet({
      id: 'pet-lb',
      name: 'Milo',
      weight_input: 22.05,
      weight_unit: 'lb',
      activity_level: 'low',
      pet_condition: 'overweight',
      neutered: true
    });

    expect(inLb.quantidade_g_dia).toBe(inKg.quantidade_g_dia);
  });
});
