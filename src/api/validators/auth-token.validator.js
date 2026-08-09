const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const authTokenSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

function parseAuthTokenInput(input) {
  const parsed = authTokenSchema.safeParse(input || {});

  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  return {
    username: parsed.data.username,
    password: parsed.data.password
  };
}

module.exports = {
  parseAuthTokenInput
};
