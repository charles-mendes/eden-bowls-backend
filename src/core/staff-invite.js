const INVITE_META_KEYS = {
  mustChangePassword: '_eden_must_change_password',
  expiresAt: '_eden_invite_expires_at',
  mailStatus: '_eden_invite_mail_status',
  resendCount: '_eden_invite_resend_count',
  resendWindowStart: '_eden_invite_resend_window_start',
  deletedAt: '_eden_deleted_at'
};

const INVITE_TTL_SECONDS = 72 * 60 * 60;
const INVITE_RESEND_MAX_ATTEMPTS = 3;
const INVITE_RESEND_WINDOW_SECONDS = 3600;

const ROLE_LABELS = {
  admin: 'Admin',
  operator: 'Operador',
  nutritionist: 'Nutricionista',
  readonly: 'Somente leitura',
  customer: 'Sem acesso ao painel'
};

function isTruthyMeta(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isMustChangePassword(value) {
  return isTruthyMeta(value);
}

function isSoftDeleted(value) {
  return Boolean(String(value || '').trim());
}

function isInviteExpired(expiresAt, nowSeconds) {
  const expires = Number(expiresAt);
  const now = Number(nowSeconds);
  if (!Number.isFinite(expires) || expires <= 0) {
    return true;
  }

  return now >= expires;
}

function roleLabel(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return ROLE_LABELS[normalized] || normalized;
}

function primaryRoleLabel(roles = []) {
  if (roles.includes('admin')) return ROLE_LABELS.admin;
  if (roles.includes('operator')) return ROLE_LABELS.operator;
  if (roles.includes('readonly')) return ROLE_LABELS.readonly;
  if (roles.includes('nutritionist')) return ROLE_LABELS.nutritionist;
  return ROLE_LABELS.customer;
}

module.exports = {
  INVITE_META_KEYS,
  INVITE_TTL_SECONDS,
  INVITE_RESEND_MAX_ATTEMPTS,
  INVITE_RESEND_WINDOW_SECONDS,
  ROLE_LABELS,
  isMustChangePassword,
  isSoftDeleted,
  isInviteExpired,
  isTruthyMeta,
  primaryRoleLabel,
  roleLabel
};
