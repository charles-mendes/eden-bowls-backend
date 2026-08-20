const { nextSettings, settingsFromRows } = require('../src/infrastructure/shipping/shipping-settings');

describe('shipping settings helpers', () => {
  test('bumps the distribution center version when lat or lng change', () => {
    const next = nextSettings(
      {
        br: {
          center: { lat: -25.44839, lng: -49.21741, version: '1' }
        }
      },
      {
        br: {
          center: { lat: -23.55, lng: -49.21741 }
        }
      }
    );

    expect(next.br.center.lat).toBe(-23.55);
    expect(next.br.center.version).toBe('2');
  });

  test('maps database rows into the admin/checkout settings shape', () => {
    const settings = settingsFromRows(
      {
        enabled: 1,
        label: 'Entrega Eden Bowl',
        center_name: 'CD Curitiba',
        center_street: '',
        center_city: 'Curitiba',
        center_state: 'PR',
        center_zipcode: '80010-000',
        center_lat: '-25.448390',
        center_lng: '-49.217410',
        center_version: '3',
        per_km: '1.10',
        road_factor: '1.3',
        min_fee: '0.00',
        max_fee: null,
        max_distance_km: '500.00',
        km_per_day: '80.00',
        min_days: 2,
        max_days: 10
      },
      {
        enabled: 0,
        cost: '15.50',
        label: 'UPS 2 days',
        carrier: 'UPS',
        delivery: '2 business days'
      }
    );

    expect(settings.br.center.name).toBe('CD Curitiba');
    expect(settings.br.center.lat).toBe(-25.44839);
    expect(settings.br.rule.per_km).toBe(1.1);
    expect(settings.br.rule.max_fee).toBeNull();
    expect(settings.us.enabled).toBe(false);
    expect(settings.us.cost).toBe(15.5);
  });
});
