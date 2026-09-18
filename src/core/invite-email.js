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
  locale
}) {
  const pt = isPortuguese(locale || 'en');
  const displayName = String(name || '').trim() || (pt ? 'olá' : 'there');
  const loginEmail = String(email || '').trim();
  const role = primaryRoleLabel(Array.isArray(roles) ? roles : []);
  const url = String(panelUrl || '').trim() || 'the admin panel';
  const expiry = formatExpiry(expiresAt);

  const subject = pt ? 'Seu acesso ao painel Eden Bowls' : 'Your Eden Bowls admin access';
  const text = [
    pt ? `Oi ${displayName},` : `Hi ${displayName},`,
    '',
    pt
      ? 'Uma conta foi criada para você no painel da Eden Bowls.'
      : 'An administrator created an account for you on the Eden Bowls admin panel.',
    '',
    `${pt ? 'Painel' : 'Panel URL'}: ${url}`,
    `${pt ? 'E-mail' : 'Login email'}: ${loginEmail}`,
    `${pt ? 'Senha temporária' : 'Temporary password'}: ${temporaryPassword}`,
    `${pt ? 'Papel' : 'Role'}: ${role}`,
    `${pt ? 'Este convite expira em' : 'This invitation expires at'}: ${expiry}`,
    '',
    pt
      ? 'Você precisa trocar essa senha no primeiro login, antes de usar qualquer outra tela.'
      : 'You must change this password on first login, before using any other screen.',
    pt
      ? 'Se o convite expirar, peça a um administrador para reenviar.'
      : 'If the invitation expires, ask an administrator to resend it.',
    '',
    'Eden Bowls'
  ].join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? `Oi ${displayName}, a cozinha interna está aberta. Entre com a senha temporária e troque-a na primeira visita.`
      : `Hi ${displayName}, the back kitchen is open. Sign in with the temporary password and change it on first visit.`),
    detailsTableHtml([
      { label: pt ? 'Painel' : 'Panel', value: url },
      { label: pt ? 'E-mail' : 'Email', value: loginEmail },
      { label: pt ? 'Senha temporária' : 'Temporary password', value: temporaryPassword },
      { label: pt ? 'Papel' : 'Role', value: role },
      { label: pt ? 'Expira' : 'Expires', value: expiry }
    ]),
    url.startsWith('http') ? buttonHtml({ href: url, label: pt ? 'Abrir o painel' : 'Open the panel' }) : '',
    mutedHtml(pt
      ? 'Se o convite expirar, peça a um administrador para reenviar.'
      : 'If the invitation expires, ask an administrator to resend it.')
  ].join('');

  return {
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'en',
      preheader: pt ? 'Senha temporária para o painel.' : 'Temporary password for the admin panel.',
      kicker: pt ? 'Equipe' : 'Staff',
      title: pt ? 'A mesa dos bastidores' : 'A seat in the back kitchen',
      innerHtml
    })
  };
}

module.exports = {
  buildInviteEmailContent,
  formatExpiry
};
