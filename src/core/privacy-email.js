const {
  buttonHtml,
  isPortuguese,
  mutedHtml,
  paragraphHtml,
  wrapEmailHtml
} = require('./email/html');

function buildPrivacyEmailContent({ confirmUrl, locale }) {
  const pt = isPortuguese(locale);
  const url = String(confirmUrl || '').trim();
  const subject = pt
    ? 'Eden Bowls — confirme sua identidade'
    : 'Eden Bowls — confirm your identity';
  const text = pt
    ? [
      'Recebemos um pedido de privacidade associado a esta conta.',
      'Confirme que você é o titular abrindo o link abaixo (válido uma vez):',
      url,
      '',
      'Se você não fez este pedido, ignore este e-mail.',
      'A Eden Bowls só atende solicitações depois de confirmar o e-mail cadastrado na conta.'
    ].join('\n')
    : [
      'We received a privacy request for this account.',
      'Confirm you are the account holder by opening the one-time link below:',
      url,
      '',
      'If you did not make this request, ignore this email.',
      'Eden Bowls only fulfills requests after confirming the email on the account.'
    ].join('\n');

  const innerHtml = [
    paragraphHtml(pt
      ? 'Chegou um pedido de privacidade ligado a esta conta. O link abaixo vale uma vez e só confirma o e-mail cadastrado — não o remetente de uma mensagem.'
      : 'A privacy request arrived for this account. The link below works once and only confirms the email on the account — never the From: address of a message.'),
    url ? buttonHtml({ href: url, label: pt ? 'Confirmar identidade' : 'Confirm identity' }) : '',
    mutedHtml(pt
      ? 'Se você não fez este pedido, ignore esta carta.'
      : 'If you did not make this request, ignore this letter.')
  ].join('');

  return {
    subject,
    text,
    html: wrapEmailHtml({
      locale,
      preheader: pt ? 'Confirme o e-mail da conta para seguir o pedido.' : 'Confirm the account email to continue the request.',
      kicker: pt ? 'Privacidade' : 'Privacy',
      title: pt ? 'Só o titular da tigela' : 'Only the bowl’s holder',
      innerHtml
    })
  };
}

module.exports = {
  buildPrivacyEmailContent
};
