const { kgToLb, planBoxes } = require('../src/core/shipping-boxes');
const { DEFAULT_SETTINGS } = require('../src/infrastructure/shipping/shipping-settings');

const boxes = DEFAULT_SETTINGS.us.boxes;
const packs = (quantity, packSizeGrams = 300, flavorKey = 'frango') => [{ flavorKey, packSizeGrams, quantity }];
const shape = (plan) => plan.map((box) => [box.key, box.pack_count]);

describe('planBoxes', () => {
  test('Small order: 8 packs go in one Starter box', () => {
    expect(shape(planBoxes({ packs: packs(8), boxes }))).toEqual([['starter', 8]]);
  });

  test('Just above the Starter: 12 packs go in one monthly box', () => {
    expect(shape(planBoxes({ packs: packs(12), boxes }))).toEqual([['monthly', 12]]);
  });

  test('Two pets: 45 packs go in two monthly boxes of 30 and 15', () => {
    expect(shape(planBoxes({ packs: [...packs(25), ...packs(20, 300, 'carne')], boxes }))).toEqual([['monthly', 30], ['monthly', 15]]);
  });

  test('Exact fit: 40 packs go in a monthly box of 30 and a Starter of 10', () => {
    expect(shape(planBoxes({ packs: packs(40), boxes }))).toEqual([['monthly', 30], ['starter', 10]]);
  });

  test('US monthly box of 500 g packs: 17.0 kg, sent as 37.5 lb', () => {
    const [box] = planBoxes({ packs: packs(30, 500), boxes, dryIceKg: 0.5 });

    expect(box).toMatchObject({
      key: 'monthly', label: 'Caixa mensal', pack_count: 30, weight_kg: 17, weight_lb: 37.5,
      length_in: 18, width_in: 14, height_in: 12, dry_ice_kg: 0.5
    });
  });

  test('BR order: 10 packs of 300 g in a Starter weigh 4.0 kg with no dry ice', () => {
    const [box] = planBoxes({ packs: packs(10), boxes, dryIceKg: 0 });

    expect(box).toMatchObject({ key: 'starter', weight_kg: 4, dry_ice_kg: 0 });
  });

  test('a Starter of 10 × 500 g rounds up to 14.4 lb', () => {
    expect(planBoxes({ packs: packs(10, 500), boxes, dryIceKg: 0.5 })[0]).toMatchObject({ weight_kg: 6.5, weight_lb: 14.4 });
  });

  test('heaviest packs first with mixed sizes', () => {
    const plan = planBoxes({
      packs: [{ flavorKey: 'frango', packSizeGrams: 300, quantity: 20 }, { flavorKey: 'carne', packSizeGrams: 500, quantity: 15 }],
      boxes
    });

    expect(plan[0].packs).toEqual([
      { flavorKey: 'carne', packSizeGrams: 500, quantity: 15 },
      { flavorKey: 'frango', packSizeGrams: 300, quantity: 15 }
    ]);
    expect(plan[1].packs).toEqual([{ flavorKey: 'frango', packSizeGrams: 300, quantity: 5 }]);
    expect(plan[1].key).toBe('starter');
  });

  test('uses the saved max_packs', () => {
    const custom = { ...boxes, monthly: { ...boxes.monthly, max_packs: 20 } };
    expect(shape(planBoxes({ packs: packs(25), boxes: custom }))).toEqual([['monthly', 20], ['starter', 5]]);
  });

  test('a cycle without packs has an empty plan', () => {
    expect(planBoxes({ packs: [], boxes })).toEqual([]);
    expect(planBoxes({ packs: undefined, boxes })).toEqual([]);
  });

  test('kgToLb rounds up to one decimal', () => {
    expect(kgToLb(17)).toBe(37.5);
    expect(kgToLb(4.5)).toBe(10);
    expect(kgToLb(11)).toBe(24.3);
  });
});
