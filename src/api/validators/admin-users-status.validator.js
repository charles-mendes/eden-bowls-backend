const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const statusSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

function parseAccountStatusInput(input) {
  const parsed = statusSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  return parsed.data.status;
}

module.exports = {
  parseAccountStatusInput
};
