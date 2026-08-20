const ADMIN_ROLES_META_KEY = '_eden_admin_roles';

const OPERATIONAL_ROLES = ['admin', 'operator', 'nutritionist', 'readonly'];

const ROLE_PERMISSIONS = {
  nutritionist: ['nutrition.simulate'],
  readonly: [
    'nutrition.simulate',
    'onboarding.read',
    'shipping.read',
    'catalog.read',
    'checkout.read',
    'billing.subscribers.read',
    'users.read'
  ],
  operator: [
    'nutrition.simulate',
    'onboarding.read',
    'shipping.read',
    'shipping.write',
    'catalog.read',
    'catalog.write',
    'catalog.sync',
    'checkout.read',
    'billing.subscribers.read',
    'billing.subscribers.sync',
    'billing.coupons.write',
    'users.read',
    'users.delivery.write'
  ]
};

ROLE_PERMISSIONS.admin = [...ROLE_PERMISSIONS.operator];

const VALID_ROLES = new Set(['admin', 'operator', 'nutritionist', 'readonly', 'customer']);

function unique(values) {
  return [...new Set(values)];
}

function parseRoles(value) {
  if (Array.isArray(value)) {
    return unique(value.map((role) => String(role || '').trim().toLowerCase()).filter((role) => VALID_ROLES.has(role)));
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parseRoles(parsed);
    }
  } catch (_error) {
    // stored as a single role or comma-separated list
  }

  return unique(
    raw
      .split(/[,\s]+/)
      .map((role) => role.trim().toLowerCase())
      .filter((role) => VALID_ROLES.has(role))
  );
}

function parseAdminEmails(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(',');

  return unique(
    list
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  );
}

function permissionsForRoles(roles = []) {
  const permissions = [];

  for (const role of roles) {
    const mapped = ROLE_PERMISSIONS[role];
    if (Array.isArray(mapped)) {
      permissions.push(...mapped);
    }
  }

  return unique(permissions);
}

function hasOperationalRole(roles = []) {
  return roles.some((role) => OPERATIONAL_ROLES.includes(role));
}

function resolveAdminRoles({ storedRoles, email, adminEmails = [] }) {
  const roles = parseRoles(storedRoles);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (normalizedEmail && adminEmails.includes(normalizedEmail) && !roles.includes('admin')) {
    roles.unshift('admin');
  }

  const operational = roles.filter((role) => role !== 'customer');
  if (operational.length === 0) {
    return ['customer'];
  }

  return unique(operational);
}

module.exports = {
  ADMIN_ROLES_META_KEY,
  OPERATIONAL_ROLES,
  ROLE_PERMISSIONS,
  VALID_ROLES,
  hasOperationalRole,
  parseAdminEmails,
  parseRoles,
  permissionsForRoles,
  resolveAdminRoles
};
