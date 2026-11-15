const { buildPrivacyExportDocument } = require('../src/core/privacy-export-document');
const { renderPrivacyExportPdf } = require('../src/infrastructure/privacy/privacy-export-pdf-renderer');

function samplePack(overrides = {}) {
  return {
    exportedAt: '2026-11-10T15:30:00.000Z',
    profile: {
      id: 77,
      fullName: 'Ana Costa',
      email: 'ana@example.com',
      phone: '+55 41 99999-0000',
      countryCode: 'BR',
      marketingOptIn: false,
      cookiePreferences: { analytics: 'granted', ads: null },
      delivery: {
        address: 'Rua das Flores', number: '120', neighborhood: 'Batel', complement: 'Apto 3', city: 'Curitiba',
        state: 'Paraná', stateCode: 'PR', zipCode: '80420-000', country: 'BR', deliveryInstructions: 'Portaria', recipientName: 'Ana Costa'
      }
    },
    pets: [{
      id: 1, name: 'Luna', breed: 'Border Collie', ageYears: 3, ageMonths: 2, weightInput: '18', weightUnit: 'kg',
      size: 'medium', activityLevel: 'high', petCondition: 'ideal', neutered: true
    }],
    consents: [{ id: 1, consentType: 'privacy_policy', status: 'granted', documentVersion: '2026-09-13', source: 'otp_verify', createdAt: '2026-10-01T12:00:00.000Z' }],
    subscriptions: [{ id: 5, status: 'active', stripeSubscriptionId: 'sub_123', stripeCustomerId: 'cus_123', currentPeriodEnd: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false, deliveryInstructions: null }],
    customerContacts: [],
    addressIssues: [],
    ...overrides
  };
}

function pageCount(buffer) {
  return (buffer.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
}

function allText(model) {
  return JSON.stringify(model);
}

describe('buildPrivacyExportDocument', () => {
  it('prints the request, the seven sections with source and purpose, and readable values', () => {
    const model = buildPrivacyExportDocument({ pack: samplePack(), requestId: 41, type: 'access', locale: 'pt-BR' });

    expect(model.meta[0].value).toBe('#41 · Acesso aos dados');
    expect(model.meta[1].value).toContain('10 de novembro de 2026');
    expect(model.sections.map((item) => item.key)).toEqual(['profile', 'delivery', 'pets', 'consents', 'subscriptions', 'contacts', 'addressIssues']);
    for (const item of model.sections) {
      expect(item.source).toBeTruthy();
      expect(item.purpose).toBeTruthy();
    }
    const pets = model.sections.find((item) => item.key === 'pets');
    expect(pets.records[0].title).toBe('Luna');
    expect(pets.records[0].rows).toEqual(expect.arrayContaining([
      { label: 'Idade', value: '3 anos e 2 meses' },
      { label: 'Nível de atividade', value: 'Alto' },
      { label: 'Castrado', value: 'Sim' }
    ]));
    expect(allText(model)).not.toContain('activityLevel":"high');
  });

  it('says there is no record for an empty section', () => {
    const model = buildPrivacyExportDocument({ pack: samplePack(), requestId: 41, locale: 'pt-BR' });

    expect(model.sections.find((item) => item.key === 'addressIssues').noRecord).toBe('Nenhum registro.');
    expect(model.sections.find((item) => item.key === 'contacts').noRecord).toBe('Nenhum registro.');
    expect(model.sections.find((item) => item.key === 'pets').noRecord).toBeNull();
  });

  it('adds the criteria line, the sharing table and what the file leaves out', () => {
    const model = buildPrivacyExportDocument({ pack: samplePack(), requestId: 41, locale: 'pt-BR' });

    expect(model.criteria.text).toContain('idade, do peso, do porte, do nível de atividade, da condição corporal');
    const recipients = model.sharing.rows.map((row) => row.recipient).join(' ');
    for (const name of ['Stripe', 'Brevo', 'MaxMind', 'Nominatim', 'ViaCEP', 'OSRM', 'UPS', 'GA4']) {
      expect(recipients).toContain(name);
    }
    expect(model.notIncluded.items.join(' ')).toContain('últimos quatro dígitos do cartão');
  });

  it('prints English titles and dates for en', () => {
    const model = buildPrivacyExportDocument({ pack: samplePack(), requestId: 7, type: 'portability', locale: 'en' });

    expect(model.heading).toBe('Your data at Eden Bowls');
    expect(model.meta[0].value).toBe('#7 · Data portability');
    expect(model.meta[1].value).toContain('November 10, 2026');
    expect(model.sections.map((item) => item.title)).toContain('Delivery address');
    expect(model.filename).toBe('eden-bowls-data-7.pdf');
  });

  it('leaves the Brazil-only address fields out of a US address', () => {
    const pack = samplePack({ profile: { fullName: 'Jane', delivery: { address: '200 Palm Ave', city: 'Boca Raton', state: 'Florida', zipCode: '33432', country: 'US' } } });
    const labels = buildPrivacyExportDocument({ pack, requestId: 1, locale: 'en' })
      .sections.find((item) => item.key === 'delivery').records[0].rows.map((row) => row.label);

    expect(labels).not.toContain('Number');
    expect(labels).not.toContain('Neighborhood');
    expect(labels).toContain('ZIP / CEP');
  });

  it('keeps an unknown stored value instead of dropping it', () => {
    const pack = samplePack({ customerContacts: [{ channel: 'whatsapp', reason: 'brand_new_reason', outcome: 'resolved', note: null, createdAt: '2026-10-02T12:00:00.000Z' }] });
    const model = buildPrivacyExportDocument({ pack, requestId: 41, locale: 'en' });
    const rows = model.sections.find((item) => item.key === 'contacts').records[0].rows;

    expect(rows).toEqual(expect.arrayContaining([{ label: 'Reason', value: 'brand_new_reason' }, { label: 'Note', value: '—' }]));
  });
});

describe('renderPrivacyExportPdf', () => {
  it.each([['pt-BR', [595.28, 841.89], 'eden-bowls-dados-41.pdf'], ['en', [612, 792], 'eden-bowls-data-41.pdf']])('%s renders a PDF in its paper size', async (locale, size, filename) => {
    const { buffer, filename: name } = await renderPrivacyExportPdf({ pack: samplePack(), requestId: 41, locale });

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.toString('latin1')).toContain(`/MediaBox [0 0 ${size[0]} ${size[1]}]`);
    expect(name).toBe(filename);
  });

  it('flows 60 contacts onto more pages', async () => {
    const contacts = Array.from({ length: 60 }, (_, index) => ({
      channel: 'whatsapp', reason: 'late', outcome: 'no_answer', note: `Tentativa ${index + 1}`, createdAt: '2026-10-02T12:00:00.000Z'
    }));
    const short = await renderPrivacyExportPdf({ pack: samplePack(), requestId: 41, locale: 'pt-BR' });
    const long = await renderPrivacyExportPdf({ pack: samplePack({ customerContacts: contacts }), requestId: 41, locale: 'pt-BR' });

    expect(pageCount(long.buffer)).toBeGreaterThan(pageCount(short.buffer));
    expect(pageCount(long.buffer)).toBeGreaterThan(3);
  });
});
