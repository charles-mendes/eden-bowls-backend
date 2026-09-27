const {
  buttonHtml,
  isPortuguese,
  mutedHtml,
  paragraphHtml,
  wrapEmailHtml
} = require('./email/html');

function buildPrivacyEmailContent({
  confirmUrl,
  locale,
  assetBaseUrl,
  allowRelativeAssets
}) {
  const pt = isPortuguese(locale);
  const url = String(confirmUrl || '').trim();
  const subject = pt
    ? 'Confirme sua identidade para continuar'
    : 'Confirm your identity to continue';
  const text = pt
    ? [
      'Recebemos um pedido relacionado aos dados da sua conta na Eden Bowls.',
      'Para continuar, confirme que foi você. O link vale uma única vez e confirma apenas o e-mail cadastrado:',
      url,
      '',
      'Se você não fez esse pedido, ignore este e-mail. Nada será alterado.'
    ].join('\n')
    : [
      'We received a request related to the data in your Eden Bowls account.',
      'To continue, confirm it was you. The link works only once and only confirms the email address on file:',
      url,
      '',
      "If you didn't make this request, ignore this email. Nothing will change."
    ].join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? 'Recebemos um pedido relacionado aos dados da sua conta na Eden Bowls. Para continuar, precisamos confirmar que foi você. Clique no botão abaixo. O link vale uma única vez e confirma apenas o e-mail cadastrado.'
      : 'We received a request related to the data in your Eden Bowls account. To continue, we need to confirm it was you. Click the button below. The link works only once and only confirms the email address on file.'),
    url ? buttonHtml({ href: url, label: pt ? 'Confirmar identidade' : 'Confirm identity' }) : '',
    mutedHtml(pt
      ? 'Se você não fez esse pedido, ignore este e-mail. Nada será alterado.'
      : "If you didn't make this request, ignore this email. Nothing will change.")
  ].join('');

  return {
    subject,
    text,
    html: wrapEmailHtml({
      locale,
      preheader: pt
        ? 'Recebemos um pedido de privacidade ligado à sua conta.'
        : 'We received a privacy request linked to your account.',
      kicker: pt ? 'Privacidade' : 'Privacy',
      title: pt ? 'Confirme sua identidade' : 'Confirm your identity',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

module.exports = {
  buildPrivacyEmailContent
};
