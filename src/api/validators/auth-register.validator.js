const { z } = require('zod');
const { HttpError } = require('../../core/http-error');

const emailExistsSchema = z.object({
  email: z.string().trim().email().max(100)
});

const registerSchema = z.object({
  username: z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._-]+$/),
  email: z.string().trim().email().max(100),
  password: z.string().min(8).regex(/[A-Z]/).regex(/[0-9]/),
  recaptchaToken: z.string().optional()
});

const otpVerifySchema = z.object({
  uid: z.coerce.number().int().positive(),
  otp: z.string().trim().regex(/^\d{6}$/),
  marketingOptIn: z.boolean().optional().default(false),
  termsAccepted: z.boolean(),
  privacyAccepted: z.boolean()
});

const otpResendSchema = z.object({
  uid: z.coerce.number().int().positive()
});

function parseOrThrow(schema, input) {
  const parsed = schema.safeParse(input || {});

  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  return parsed.data;
}

function parseEmailExistsInput(input) {
  const data = parseOrThrow(emailExistsSchema, input);
  return {
    email: data.email.toLowerCase()
  };
}

function parseRegisterInput(input) {
  const data = parseOrThrow(registerSchema, input);
  return {
    username: data.username,
    email: data.email.toLowerCase(),
    password: data.password,
    recaptchaToken: data.recaptchaToken || ''
  };
}

function parseOtpVerifyInput(input) {
  return parseOrThrow(otpVerifySchema, input);
}

function parseOtpResendInput(input) {
  return parseOrThrow(otpResendSchema, input);
}

module.exports = {
  parseEmailExistsInput,
  parseRegisterInput,
  parseOtpVerifyInput,
  parseOtpResendInput
};
