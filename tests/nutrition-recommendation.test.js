const { COMBINATION_FACTORS, DEFAULT_NUTRITION_PARAMETERS, GIANT_COMBINATION_FACTORS, buildForPet, calculateFood, upgradeNutritionParameters } = require('../src/core/nutrition-recommendation');

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
    expect(result.decision_trace).toEqual([`combination:${key}:${expectedFactor}`]);
  });

  test.each(Object.entries(GIANT_COMBINATION_FACTORS))('applies the giant factor %s = %s to a dog over 40 kg', (key, expectedFactor) => {
    const [castrado, atividade, score] = key.split('-');
    const result = calculateFood({ especie: 'cao', peso: 45, castrado, nivel_atividade: atividade, score_corporal: score, nem_kcal_kg: 3600 });

    expect(result.porte).toBe('gigante');
    expect(result.fator_aplicado).toBe(expectedFactor);
    expect(result.decision_trace).toEqual([`giant_combination:${key}:${expectedFactor}`]);
  });

  test('matches the dog example of the veterinarian document: 30 kg SIM-ALTO-ACIMA, EM 1150', () => {
    const result = calculateFood({ especie: 'cao', peso: 30, castrado: 'SIM', nivel_atividade: 'ALTO', score_corporal: 'ACIMA', nem_kcal_kg: 1150 });

    expect(result.fator_aplicado).toBe(85);
    expect(result.energia_kcal_dia).toBe(1090);
    expect(result.quantidade_g_dia).toBe(947);
  });

  test('a dog of 40 kg keeps the general matrix; over 40 kg or a giant breed gets the giant one', () => {
    const answers = { castrado: 'NAO', nivel_atividade: 'ALTO', score_corporal: 'ABAIXO', nem_kcal_kg: 3600 };

    expect(calculateFood({ especie: 'cao', peso: 40, ...answers }).fator_aplicado).toBe(100);
    expect(calculateFood({ especie: 'cao', peso: 40.5, ...answers }).fator_aplicado).toBe(115);
    expect(calculateFood({ especie: 'cao', peso: 30, porte: 'gigante', ...answers }).fator_aplicado).toBe(115);
    // The store declares only small, medium or large: a large dog over 40 kg is still giant.
    expect(calculateFood({ especie: 'cao', peso: 45, porte: 'large', ...answers }).decision_trace).toEqual(['giant_combination:NAO-ALTO-ABAIXO:115']);
    for (const raca of ['Dogue Alemão', 'Terra Nova', 'São Bernardo']) {
      const result = calculateFood({ especie: 'cao', peso: 35, raca, ...answers });
      expect(result.decision_trace).toEqual(['giant_combination:NAO-ALTO-ABAIXO:115']);
    }
  });

  test.each([
    ['filhote', 'ate_50', 210, 'growth:CRESCIMENTO_ATE_50:210'],
    ['filhote', '51_80', 175, 'growth:CRESCIMENTO_51_80:175'],
    ['puppy', '', 140, 'growth:CRESCIMENTO_81_100:140'],
    ['gestante', '', 132, 'state:GESTANTE:132'],
    ['senior', '', 95, 'state:SENIOR:95']
  ])('a %s dog (growth %s) gets the stage factor %s of Tabela 1, not the matrix', (estado, growth, factor, step) => {
    const result = calculateFood({
      especie: 'cao', peso: 12, castrado: 'SIM', nivel_atividade: 'BAIXO', score_corporal: 'ACIMA',
      estado_fisiologico: estado, growth_stage: growth, nem_kcal_kg: 3600
    });

    expect(result.fator_aplicado).toBe(factor);
    expect(result.decision_trace).toEqual([step]);
  });

  test.each([
    ['indoor', 7.5, 'BAIXO', 'ADEQUADO', 957, 60, 0.67, 231, 242],
    ['indoor and obese', 7.5, 'BAIXO', 'ACIMA', 957, 60, 0.4, 134, 140],
    ['active', 3.8, 'ALTO', 'ADEQUADO', 1200, 100, 0.67, 245, 204],
    ['active and obese', 3.8, 'ALTO', 'ACIMA', 1200, 100, 0.4, 171, 142],
    ['moderately active, so indoor', 3.8, 'MODERADO', 'ADEQUADO', 1200, 60, 0.67, 147, 122]
  ])('a %s cat matches the veterinarian document', (_label, peso, atividade, score, em, factor, exponent, kcal, grams) => {
    const result = calculateFood({ especie: 'gato', peso, castrado: 'SIM', nivel_atividade: atividade, score_corporal: score, nem_kcal_kg: em });

    expect(result.fator_aplicado).toBe(factor);
    expect(result.expoente_peso).toBe(exponent);
    expect(result.energia_kcal_dia).toBe(kcal);
    expect(result.quantidade_g_dia).toBe(grams);
    expect(result.decision_trace.join('|')).not.toContain('combination');
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
    expect(dogDefault.nem_kcal_kg).toBe(1200);
    expect(catDefault.nem_kcal_kg).toBe(1200);
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
    expect(result.quantidade_g_dia).toBe(Math.round((85 * (10 ** 0.75) / 1200) * 1000));
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

  describe('parameter set', () => {
    const greatDane = { especie: 'cao', peso: 35, castrado: 'NAO', nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO', raca: 'Great Dane' };

    test('gives the same result with the default set as without one', () => {
      expect(calculateFood(greatDane, '', DEFAULT_NUTRITION_PARAMETERS)).toEqual(calculateFood(greatDane));
    });

    test('a changed giant factor changes the result of a giant breed', () => {
      const parameters = { ...DEFAULT_NUTRITION_PARAMETERS, combination_giant: { ...DEFAULT_NUTRITION_PARAMETERS.combination_giant, 'NAO-BAIXO-ADEQUADO': 90 } };

      expect(calculateFood(greatDane).decision_trace).toEqual(['giant_combination:NAO-BAIXO-ADEQUADO:95']);
      expect(calculateFood(greatDane, '', parameters).decision_trace).toEqual(['giant_combination:NAO-BAIXO-ADEQUADO:90']);
    });

    test('a breed moved out of the giant groups under 40 kg gets the general matrix', () => {
      const parameters = {
        ...DEFAULT_NUTRITION_PARAMETERS,
        breed_groups: { ...DEFAULT_NUTRITION_PARAMETERS.breed_groups, dogue: DEFAULT_NUTRITION_PARAMETERS.breed_groups.dogue.filter((breed) => breed !== 'great dane') }
      };

      expect(calculateFood(greatDane, '', parameters).decision_trace).toEqual(['combination:NAO-BAIXO-ADEQUADO:95']);
    });

    test('a set saved before the document gets the giant matrix and the cat factors 60 and 100', () => {
      const legacy = {
        combination: { ...COMBINATION_FACTORS },
        state: { ...DEFAULT_NUTRITION_PARAMETERS.state },
        base: { dog: 95, cat: 242, cat_overweight: 134, dogue: 200 },
        nem: { dog: 3600, cat: 3800 },
        breed_groups: DEFAULT_NUTRITION_PARAMETERS.breed_groups
      };

      expect(upgradeNutritionParameters(legacy)).toMatchObject({ base: { cat: 60, cat_active: 100 }, combination_giant: GIANT_COMBINATION_FACTORS });
      expect(upgradeNutritionParameters(DEFAULT_NUTRITION_PARAMETERS)).toBe(DEFAULT_NUTRITION_PARAMETERS);
      expect(calculateFood({ especie: 'gato', peso: 7.5, nem_kcal_kg: 957 }, '', legacy).fator_aplicado).toBe(60);
    });

    test('reads the default NEM of the set', () => {
      const parameters = { ...DEFAULT_NUTRITION_PARAMETERS, nem: { dog: 4000, cat: 3800 } };

      expect(calculateFood(greatDane, '', parameters).nem_kcal_kg).toBe(4000);
    });
  });
});
