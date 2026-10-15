const { HttpError } = require('./http-error');
const { addCalendarDays, dateKey, timeZoneFor, zonedParts } = require('./delivery-closed-days');

const TYPES = ['national', 'regional', 'carrier', 'adhoc'];
const CREATABLE = { BR: ['regional', 'adhoc'], US: ['regional', 'carrier', 'adhoc'] };
const ORIGIN_BY_TYPE = { regional: 'regional', carrier: 'ups', adhoc: 'one_off' };
const FLAGS = ['closesPreparation', 'closesPickup', 'closesDelivery'];
const SHORT_NOTICE_DAYS = 7;

function invalid(message, code) {
  return new HttpError(422, message, { code });
}

function parseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw invalid('Data inválida.', 'invalid_date');
  }
  const [year, month, day] = text.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw invalid('Data inválida.', 'invalid_date');
  }
  return text;
}

function flagValue(body, name, fallback) {
  if (body[name] === undefined) return fallback;
  if (typeof body[name] !== 'boolean') {
    throw invalid('Marcação inválida.', 'invalid_flag');
  }
  return body[name];
}

function assertSomeFlag(row) {
  if (!FLAGS.some((flag) => row[flag])) {
    throw invalid('Marque ao menos preparo, coleta ou entrega. Para abrir o dia, desative a linha.', 'flag_required');
  }
}

// A new row from the panel. National rows come only from year generation; carrier rows exist only in the US.
function newRow(market, body = {}) {
  const type = String(body.type || '').trim();
  if (!TYPES.includes(type)) {
    throw invalid('Tipo inválido.', 'invalid_type');
  }
  if (!CREATABLE[market].includes(type)) {
    throw invalid(
      type === 'national' ? 'Feriado nacional não pode ser criado pelo painel.' : 'Calendário da transportadora existe só nos EUA.',
      'type_not_allowed'
    );
  }
  const label = String(body.label || '').trim();
  if (!label || label.length > 191) {
    throw invalid('Informe um rótulo de até 191 caracteres.', 'invalid_label');
  }
  const row = {
    market,
    closedOn: parseDate(body.closedOn),
    label,
    origin: ORIGIN_BY_TYPE[type],
    type,
    active: true,
    closesPreparation: flagValue(body, 'closesPreparation', false),
    closesPickup: flagValue(body, 'closesPickup', false),
    closesDelivery: flagValue(body, 'closesDelivery', false)
  };
  assertSomeFlag(row);
  return row;
}

// The same row after an edit of its flags or of `active`. Label, date, and type do not change.
function changedRow(existing, body = {}) {
  const row = { ...existing };
  for (const flag of FLAGS) {
    row[flag] = flagValue(body, flag, existing[flag]);
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      throw invalid('Valor de ativo inválido.', 'invalid_active');
    }
    row.active = body.active;
  }
  assertSomeFlag(row);
  return row;
}

function sameRow(left, right) {
  return left.market === right.market && left.closedOn === right.closedOn && left.type === right.type;
}

function assertNoTwin(activeAndInactiveRows, row) {
  if ((activeAndInactiveRows || []).some((item) => item.id !== row.id && sameRow(item, row))) {
    throw new HttpError(409, 'Já existe uma linha desse tipo nessa data.', { code: 'closed_day_conflict' });
  }
}

// The active rows of the market with the change applied, for the projection.
function rowsWith(activeRows, change) {
  const others = (activeRows || []).filter((item) => !(change.id != null && item.id === change.id) && !sameRow(item, change));
  return change.active ? others.concat([change]) : others;
}

function turnsFlagOn(before, after) {
  if (!after.active) return false;
  if (!before || !before.active) return true;
  return FLAGS.some((flag) => after[flag] && !before[flag]);
}

function shortNotice(market, closedOn, now) {
  const parts = zonedParts(now, timeZoneFor(market));
  const limit = addCalendarDays(parts.year, parts.month, parts.day, SHORT_NOTICE_DAYS);
  return closedOn < dateKey(limit.year, limit.month, limit.day);
}

module.exports = {
  FLAGS,
  SHORT_NOTICE_DAYS,
  TYPES,
  assertNoTwin,
  changedRow,
  newRow,
  rowsWith,
  shortNotice,
  turnsFlagOn
};
