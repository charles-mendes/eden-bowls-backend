const { z } = require('zod');
const { HttpError } = require('../../core/http-error');
const { OPERATIONAL_ROLES, normalizeAssignableRoles } = require('../../core/admin-roles');

const assignmentSchema = z.object({
  role: z.string().optional().nullable(),
  roles: z.array(z.string()).optional()
});

function parseRolesAssignmentInput(input) {
  const parsed = assignmentSchema.safeParse(input || {});
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid request payload.', parsed.error.issues);
  }

  const hasRole = Object.prototype.hasOwnProperty.call(input || {}, 'role');
  const hasRoles = Object.prototype.hasOwnProperty.call(input || {}, 'roles');
  if (!hasRole && !hasRoles) {
    throw new HttpError(400, 'Invalid request payload.', { code: 'roles_required' });
  }

  const requested = hasRoles
    ? parsed.data.roles || []
    : parsed.data.role == null || parsed.data.role === ''
      ? []
      : [parsed.data.role];

  for (const role of requested) {
    const normalized = String(role || '').trim().toLowerCase();
    if (!normalized || normalized === 'customer') {
      continue;
    }
    if (!OPERATIONAL_ROLES.includes(normalized)) {
      throw new HttpError(400, 'Invalid role.', { code: 'invalid_role', role: normalized });
    }
  }

  return normalizeAssignableRoles(requested);
}

module.exports = {
  parseRolesAssignmentInput
};
