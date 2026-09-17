const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const { OPERATIONAL_ROLES, normalizeAssignableRoles } = require('../../core/admin-roles');

const emailSchema = z.string().trim().email();

const createSchema = z.object({
  name: z.string().trim().min(1).max(191),
  email: emailSchema,
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.string().trim().min(1)
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(191).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.string().trim().min(1).optional(),
  email: z.string().optional()
});

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(1)
});

function invalidPayload(issues) {
  throw new HttpError(400, 'Invalid request payload.', issues);
}

function parseAccessRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  if (!OPERATIONAL_ROLES.includes(normalized)) {
    throw new HttpError(400, 'Invalid role.', { code: 'invalid_role', role: normalized });
  }

  return normalizeAssignableRoles([normalized]);
}

function parseCreateAccessInput(input) {
  const parsed = createSchema.safeParse(input || {});
  if (!parsed.success) {
    invalidPayload(parsed.error.issues);
  }

  return {
    name: parsed.data.name,
    email: parsed.data.email.trim().toLowerCase(),
    phone: parsed.data.phone ? parsed.data.phone.trim() : '',
    roles: parseAccessRole(parsed.data.role)
  };
}

function parseUpdateAccessInput(input) {
  const body = input || {};
  if (Object.prototype.hasOwnProperty.call(body, 'email')) {
    throw new HttpError(422, 'Email cannot be changed after the account is created.', {
      code: 'email_immutable',
      field: 'email'
    });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    invalidPayload(parsed.error.issues);
  }

  const patch = {};
  if (parsed.data.name != null) {
    patch.name = parsed.data.name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'phone')) {
    patch.phone = parsed.data.phone ? parsed.data.phone.trim() : '';
  }
  if (parsed.data.role != null) {
    patch.roles = parseAccessRole(parsed.data.role);
  }

  if (!Object.keys(patch).length) {
    throw new HttpError(400, 'Invalid request payload.', { code: 'empty_patch' });
  }

  return patch;
}

function parsePasswordChangeInput(input) {
  const parsed = passwordSchema.safeParse(input || {});
  if (!parsed.success) {
    invalidPayload(parsed.error.issues);
  }

  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    throw new HttpError(422, 'New passwords do not match.', {
      code: 'password_mismatch',
      field: 'confirmPassword'
    });
  }

  return {
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword
  };
}

module.exports = {
  parseCreateAccessInput,
  parseUpdateAccessInput,
  parsePasswordChangeInput
};
