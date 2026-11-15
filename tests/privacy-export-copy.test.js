const {
  EXPORT_COPY,
  exportCopy,
  resolveExportLocale,
  translateValue
} = require('../src/core/privacy-export-copy');
const { LEGAL_DOCUMENT_SEED } = require('../src/infrastructure/migrations/helpers/seed-legal-documents');

function keyPaths(value, prefix = '') {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`];
  if (!value || typeof value !== 'object') return [prefix];
  return Object.keys(value).sort().flatMap((key) => keyPaths(value[key], prefix ? `${prefix}.${key}` : key));
}

// First cell of each row of the policy's sharing table.
function policyRecipients(market) {
  const body = LEGAL_DOCUMENT_SEED.find((item) => item.market === market && item.kind === 'privacy').body;
  const start = body.search(/^## (Compartilhamento|Sharing)/m);
  const section = body.slice(start, body.indexOf('\n## ', start + 3));
  return section.split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('|---'))
    .slice(1)
    .map((line) => line.split('|')[1].trim());
}

describe('privacy export copy', () => {
  it('picks the language from the locale, then from the market', () => {
    expect(resolveExportLocale({ locale: 'pt-BR', market: 'US' })).toBe('pt-BR');
    expect(resolveExportLocale({ locale: 'en-US', market: 'BR' })).toBe('en');
    expect(resolveExportLocale({ locale: null, market: 'US' })).toBe('en');
    expect(resolveExportLocale({ locale: '', market: 'BR' })).toBe('pt-BR');
    expect(resolveExportLocale({ locale: 'es', market: 'US' })).toBe('en');
    expect(resolveExportLocale({})).toBe('pt-BR');
  });

  it('translates known values and prints unknown ones as stored', () => {
    expect(translateValue('pt-BR', 'activityLevel', 'high')).toBe('Alto');
    expect(translateValue('en', 'consentType', 'marketing_email')).toBe('Promotional emails');
    expect(translateValue('en', 'contactReason', 'something_new')).toBe('something_new');
    expect(translateValue('pt-BR', 'size', null)).toBeNull();
  });

  it('has the same keys in both languages', () => {
    expect(keyPaths(EXPORT_COPY.en)).toEqual(keyPaths(EXPORT_COPY['pt-BR']));
  });

  it('gives every section a source and a purpose', () => {
    for (const locale of ['pt-BR', 'en']) {
      for (const section of Object.values(exportCopy(locale).sections)) {
        expect(section.source.length).toBeGreaterThan(10);
        expect(section.purpose.length).toBeGreaterThan(10);
      }
    }
  });

  it.each([['pt-BR', 'BR'], ['en', 'US']])('lists every recipient of the %s policy sharing table', (locale, market) => {
    const recipients = policyRecipients(market);
    expect(recipients.length).toBeGreaterThanOrEqual(8);
    expect(exportCopy(locale).sharing.rows.map((row) => row.recipient)).toEqual(recipients);
  });
});
