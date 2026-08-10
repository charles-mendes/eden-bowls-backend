const { z } = require('zod');

const onboardingAddressAutocompletePayloadSchema = z.object({
  query: z.string().trim().min(1, 'Query is required.').optional(),
  country: z.enum(['US', 'BR']).optional(),
  zipcode: z.string().trim().optional(),
  state: z.string().trim().optional(),
  city: z.string().trim().optional()
});

function parseAutocompleteAddressInput(payload = {}) {
  const parsed = onboardingAddressAutocompletePayloadSchema.parse(payload || {});
  const normalized = {
    query: parsed.query || ''
  };

  if (parsed.country) {
    normalized.country = parsed.country;
  }

  if (parsed.zipcode) {
    normalized.zipcode = parsed.zipcode;
  }

  if (parsed.state) {
    normalized.state = parsed.state;
  }

  if (parsed.city) {
    normalized.city = parsed.city;
  }

  return normalized;
}

module.exports = {
  parseAutocompleteAddressInput
};
