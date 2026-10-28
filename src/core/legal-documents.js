const { HttpError } = require('./http-error');

const LEGAL_KINDS = ['privacy', 'terms'];
const LEGAL_MARKETS = ['BR', 'US'];
const LEGAL_DOCUMENT_INVALID = 'legal_document_invalid';
const MAX_BODY_LENGTH = 100000;

// The kind of a route, or null for an unknown one (the route answers 404).
function legalKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  return LEGAL_KINDS.includes(kind) ? kind : null;
}

function legalMarket(value) {
  const market = String(value || '').trim().toUpperCase();
  if (!LEGAL_MARKETS.includes(market)) {
    throw new HttpError(400, 'Market must be BR or US.', { code: 'invalid_market' });
  }
  return market;
}

function isVersionId(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * A version to publish: an id `YYYY-MM-DD` that is a real date and a Markdown body of 1 to 100,000
 * characters (legal-documents), or 422 `legal_document_invalid` listing the fields.
 */
function parseLegalPublication(input) {
  const source = input && typeof input === 'object' ? input : {};
  const version = String(source.version == null ? '' : source.version).trim();
  const body = typeof source.body_markdown === 'string' ? source.body_markdown.replace(/\r\n/g, '\n') : '';
  const invalid = [];
  if (!isVersionId(version)) invalid.push('version');
  if (!body.trim() || body.length > MAX_BODY_LENGTH) invalid.push('body_markdown');
  if (invalid.length) {
    throw new HttpError(422, `Invalid legal document: ${invalid.join(', ')}.`, { code: LEGAL_DOCUMENT_INVALID, fields: invalid });
  }
  return { version, body };
}

module.exports = {
  LEGAL_DOCUMENT_INVALID,
  LEGAL_KINDS,
  LEGAL_MARKETS,
  isVersionId,
  legalKind,
  legalMarket,
  parseLegalPublication
};
