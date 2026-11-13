const { HttpError } = require('../../core/http-error');

const CONTACT_REASONS = ['payment_failed', 'late', 'delivery_failed', 'address'];
const CONTACT_OUTCOMES = ['no_answer', 'customer_will_fix', 'resolved'];
const NOTE_MAX = 500;

function invalid(field, message) {
  return new HttpError(422, message, { code: 'invalid_contact', field });
}

// A contact made by WhatsApp (customer-contacts). The channel is fixed, so the body never carries it.
function parseContactInput(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'The request body must be an object.', { code: 'invalid_body' });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!CONTACT_REASONS.includes(reason)) {
    throw invalid('reason', `reason must be one of ${CONTACT_REASONS.join(', ')}.`);
  }
  const outcome = typeof body.outcome === 'string' ? body.outcome.trim() : '';
  if (!CONTACT_OUTCOMES.includes(outcome)) {
    throw invalid('outcome', `outcome must be one of ${CONTACT_OUTCOMES.join(', ')}.`);
  }
  if (body.note != null && typeof body.note !== 'string') {
    throw invalid('note', 'note must be text.');
  }
  const note = String(body.note || '').trim();
  if ([...note].length > NOTE_MAX) {
    throw invalid('note', `note must have at most ${NOTE_MAX} characters.`);
  }
  return { reason, outcome, note: note || null };
}

module.exports = { CONTACT_OUTCOMES, CONTACT_REASONS, parseContactInput };
