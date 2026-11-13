const TAX_DOCUMENT_META_KEY = '_eden_tax_document';
// Civil name for the NF-e. `display_name` can be a nickname and the note goes to the tax authority.
const FISCAL_NAME_META_KEY = '_eden_fiscal_name';
const FISCAL_NAME_MAX_LENGTH = 60;
const CPF_LENGTH = 11;
const CNPJ_LENGTH = 14;

function digitsOf(value) {
  return String(value == null ? '' : value).replace(/\D/g, '');
}

function checkDigit(digits, weights) {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isValidCpf(digits) {
  if (digits.length !== CPF_LENGTH || /^(\d)\1+$/.test(digits)) return false;
  return checkDigit(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[9])
    && checkDigit(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[10]);
}

function isValidCnpj(digits) {
  if (digits.length !== CNPJ_LENGTH || /^(\d)\1+$/.test(digits)) return false;
  return checkDigit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[12])
    && checkDigit(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[13]);
}

// The digits and the kind of a valid CPF or CNPJ, or null. Punctuation is ignored.
function parseTaxDocument(value) {
  const digits = digitsOf(value);
  if (isValidCpf(digits)) return { digits, kind: 'cpf' };
  if (isValidCnpj(digits)) return { digits, kind: 'cnpj' };
  return null;
}

// New documents are CPF only: the store sells to individuals. A stored CNPJ stays valid for an old note.
function parseCpf(value) {
  const document = parseTaxDocument(value);
  return document && document.kind === 'cpf' ? document.digits : null;
}

// The name with single spaces, or null without at least two words or past the size of the note field.
function parseFiscalName(value) {
  const name = String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  return name.includes(' ') && name.length <= FISCAL_NAME_MAX_LENGTH ? name : null;
}

module.exports = {
  FISCAL_NAME_META_KEY,
  TAX_DOCUMENT_META_KEY,
  digitsOf,
  parseCpf,
  parseFiscalName,
  parseTaxDocument
};
