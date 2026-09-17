const { primaryRoleLabel } = require('./staff-invite');

function formatExpiry(expiresAtSeconds) {
  const expires = Number(expiresAtSeconds);
  if (!Number.isFinite(expires) || expires <= 0) {
    return '72 hours';
  }

  return new Date(expires * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function buildInviteEmailContent({
  name,
  email,
  temporaryPassword,
  roles,
  panelUrl,
  expiresAt
}) {
  const displayName = String(name || '').trim() || 'there';
  const loginEmail = String(email || '').trim();
  const role = primaryRoleLabel(Array.isArray(roles) ? roles : []);
  const url = String(panelUrl || '').trim() || 'the admin panel';
  const expiry = formatExpiry(expiresAt);

  return {
    subject: 'Your Eden Bowls admin access',
    text: [
      `Hi ${displayName},`,
      '',
      'An administrator created an account for you on the Eden Bowls admin panel.',
      '',
      `Panel URL: ${url}`,
      `Login email: ${loginEmail}`,
      `Temporary password: ${temporaryPassword}`,
      `Role: ${role}`,
      `This invitation expires at: ${expiry}`,
      '',
      'You must change this password on first login, before using any other screen.',
      'If the invitation expires, ask an administrator to resend it.',
      '',
      'Eden Bowls'
    ].join('\n')
  };
}

module.exports = {
  buildInviteEmailContent
};
