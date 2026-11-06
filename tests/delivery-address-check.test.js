const { brazilAddressIssues, missingAddressFields, usAddressIssues } = require('../src/core/delivery-address-check');

const brazil = { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Curitiba', state: 'PR', zipcode: '80010-000', recipient_name: 'Ana Costa' };
const us = { line1: '1 Main St', city: 'Miami', state: 'FL', postal_code: '33101', country: 'US' };

describe('brazilAddressIssues', () => {
  test('a complete address passes, whatever key holds the street and the CEP', () => {
    expect(brazilAddressIssues(brazil)).toEqual([]);
    const { street, zipcode, ...rest } = brazil;
    expect(brazilAddressIssues({ ...rest, line1: street, postal_code: zipcode })).toEqual([]);
    expect(brazilAddressIssues(JSON.stringify(brazil))).toEqual([]);
  });

  test.each([
    ['street', { street: '' }, 'address_street_missing'],
    ['number', { number: ' ' }, 'address_number_missing'],
    ['neighborhood', { neighborhood: undefined }, 'address_neighborhood_missing'],
    ['city', { city: '' }, 'address_city_missing'],
    ['state', { state: '' }, 'address_state_missing'],
    ['CEP with 7 digits', { zipcode: '8001000' }, 'address_zipcode_invalid'],
    ['recipient', { recipient_name: '' }, 'recipient_name_missing']
  ])('names a missing %s', (_label, patch, code) => {
    expect(brazilAddressIssues({ ...brazil, ...patch })).toEqual([code]);
  });

  test('lists every missing field at once', () => {
    expect(brazilAddressIssues({})).toHaveLength(7);
  });
});

describe('usAddressIssues', () => {
  test('one reason, in the order UPS checks it', () => {
    expect(usAddressIssues(us)).toEqual([]);
    expect(usAddressIssues({ ...us, line1: 'PO Box 12', postal_code: '' })).toEqual(['po_box_not_allowed']);
    expect(usAddressIssues({ ...us, city: 'APO', postal_code: '' })).toEqual(['military_address_not_supported']);
    expect(usAddressIssues({ ...us, postal_code: '' })).toEqual(['address_incomplete']);
  });
});

describe('missingAddressFields', () => {
  test('Brazil needs the number and the neighborhood, the US does not', () => {
    expect(missingAddressFields({ ...brazil, neighborhood: '' }, 'BR')).toEqual(['neighborhood']);
    expect(missingAddressFields(us, 'US')).toEqual([]);
    expect(missingAddressFields({ ...us, line1: '' }, 'US')).toEqual(['street']);
  });
});
