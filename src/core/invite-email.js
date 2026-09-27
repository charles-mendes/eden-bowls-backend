const { primaryRoleLabel } = require('./staff-invite');
const {
  buttonHtml,
  detailsTableHtml,
  isPortuguese,
  mutedHtml,
  paragraphHtml,
  wrapEmailHtml
} = require('./email/html');

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
  expiresAt,
  locale,
  assetBaseUrl,
  allowRelativeAssets
}) {
  const pt = isPortuguese(locale || 'en');
  const displayName = String(name || '').trim() || (pt ? 'olá' : 'there');
  const loginEmail = String(email || '').trim();
  const role = primaryRoleLabel(Array.isArray(roles) ? roles : []);
  const url = String(panelUrl || '').trim() || 'the admin panel';
  const expiry = formatExpiry(expiresAt);

  const subject = pt ? 'Seu acesso ao painel da Eden Bowls' : 'Your access to the Eden Bowls dashboard';
  const text = [
    pt ? `Oi, ${displayName}.` : `Hi ${displayName},`,
    '',
    pt
      ? 'Você foi convidada para acessar o painel interno da Eden Bowls. Entre com a senha temporária e troque-a no primeiro acesso.'
      : "You've been invited to the Eden Bowls internal dashboard. Sign in with the temporary password and change it on your first login.",
    '',
    `${pt ? 'Painel' : 'Dashboard'}: ${url}`,
    `${pt ? 'E-mail' : 'Email'}: ${loginEmail}`,
    `${pt ? 'Senha temporária' : 'Temporary password'}: ${temporaryPassword}`,
    `${pt ? 'Função' : 'Role'}: ${role}`,
    `${pt ? 'Expira em' : 'Expires'}: ${expiry}`,
    '',
    pt
      ? 'Se o convite expirar, peça a um administrador para enviar um novo.'
      : 'If the invitation expires, ask an administrator to send a new one.',
    '',
    'Eden Bowls'
  ].join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi, ${displayName}. Você foi convidada para acessar o painel interno da Eden Bowls. Entre com a senha temporária abaixo e troque-a no primeiro acesso.`
      : `Hi ${displayName}, you've been invited to the Eden Bowls internal dashboard. Sign in with the temporary password below and change it on your first login.`),
    detailsTableHtml([
      { label: pt ? 'Painel' : 'Dashboard', value: url },
      { label: pt ? 'E-mail' : 'Email', value: loginEmail },
      { label: pt ? 'Senha temporária' : 'Temporary password', value: temporaryPassword },
      { label: pt ? 'Função' : 'Role', value: role },
      { label: pt ? 'Expira em' : 'Expires', value: expiry }
    ]),
    url.startsWith('http') ? buttonHtml({ href: url, label: pt ? 'Acessar o painel' : 'Open dashboard' }) : '',
    mutedHtml(pt
      ? 'Se o convite expirar, peça a um administrador para enviar um novo.'
      : 'If the invitation expires, ask an administrator to send a new one.')
  ].join('');

  return {
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'en',
      preheader: pt ? 'Senha temporária para o primeiro acesso.' : 'Temporary password for your first login.',
      kicker: pt ? 'Equipe' : 'Team',
      title: pt ? 'Bem-vinda à equipe' : 'Welcome to the team',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

module.exports = {
  buildInviteEmailContent,
  formatExpiry
};
