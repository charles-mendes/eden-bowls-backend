const { DateTime } = require('luxon');

const PREFIX = 'EB';

// EB-2026-000418: the year of issue in the market timezone and a sequence that restarts every year.
function formatInvoiceNumber(year, sequence) {
  return `${PREFIX}-${year}-${String(sequence).padStart(6, '0')}`;
}

function invoiceYear(issuedAtSeconds, locale) {
  const zone = locale === 'pt-BR' ? 'America/Sao_Paulo' : 'America/New_York';
  const date = Number.isFinite(Number(issuedAtSeconds)) && Number(issuedAtSeconds) > 0
    ? DateTime.fromSeconds(Number(issuedAtSeconds), { zone })
    : DateTime.now().setZone(zone);
  return date.year;
}

module.exports = {
  formatInvoiceNumber,
  invoiceYear
};
