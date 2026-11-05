const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const { parseCpf, parseFiscalName } = require('../../core/tax-document');

const querySchema = z.object({
  // One status, or up to three separated by commas ("Precisam de ação").
  status: z.string().trim().max(120).optional(),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  search: z.string().trim().max(120).optional()
}).passthrough();

// `to` is the last day of the period, inclusive.
function parseNfeListQuery(query = {}) {
  const parsed = querySchema.safeParse(query);
  if (!parsed.success) {
    throw new HttpError(422, 'Invalid NF-e filters.', { code: 'invalid_nfe_filters' });
  }
  const { status, from, to, search } = parsed.data;
  const end = to ? new Date(`${to}T00:00:00Z`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  const statuses = String(status || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (statuses.length > 3) {
    throw new HttpError(422, 'Invalid status.', { code: 'invalid_status' });
  }
  return {
    status: statuses.length > 1 ? statuses : (statuses[0] || undefined),
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: end || undefined,
    search: search || undefined
  };
}

const required = (max) => z.string().trim().min(1).max(max);

const customerSchema = z.object({
  name: required(255).transform((value, context) => {
    const name = parseFiscalName(value);
    if (!name) context.addIssue({ code: 'custom', message: 'Invalid name.' });
    return name;
  }),
  email: z.string().trim().email().max(255),
  document: required(32),
  // Why the operator corrected this note; kept only in the audit event.
  reason: z.string().trim().min(3).max(255).optional(),
  address: z.object({
    street: required(255),
    number: required(32),
    complement: z.string().trim().max(120).optional().default(''),
    neighborhood: required(120),
    city: required(120),
    state: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
    zipcode: z.string().trim().regex(/^\d{5}-?\d{3}$/).transform((value) => value.replace('-', ''))
  })
});

function parseNfeCustomerInput(body = {}) {
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(422, 'Invalid customer data.', { code: 'invalid_nfe_customer' });
  }
  const document = parseCpf(parsed.data.document);
  if (!document) {
    throw new HttpError(422, 'Invalid CPF.', { code: 'invalid_tax_document' });
  }
  return { ...parsed.data, document };
}

module.exports = {
  parseNfeCustomerInput,
  parseNfeListQuery
};
