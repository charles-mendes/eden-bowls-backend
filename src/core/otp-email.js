const {
  codeWellHtml,
  isPortuguese,
  mutedHtml,
  paragraphHtml,
  wrapEmailHtml
} = require('./email/html');

const OTP_TTL_FLOOR_SECONDS = 900;
const OTP_TTL_DEFAULT_SECONDS = 600;

function effectiveOtpTtlSeconds(value) {
  const parsed = Number(value);
  const ttl = Number.isFinite(parsed) && parsed > 0 ? parsed : OTP_TTL_DEFAULT_SECONDS;
  return Math.max(OTP_TTL_FLOOR_SECONDS, ttl);
}

function buildOtpEmailContent({
  otp,
  expiresInSeconds,
  locale,
  assetBaseUrl,
  allowRelativeAssets
}) {
  const minutes = Math.max(1, Math.floor(Number(expiresInSeconds || OTP_TTL_FLOOR_SECONDS) / 60));
  const code = String(otp || '').trim();
  const pt = isPortuguese(locale || 'pt-BR');

  const subject = pt ? 'Seu código de verificação Eden Bowls' : 'Your Eden Bowls verification code';
  const text = pt
    ? `Seu código de verificação Eden Bowls é ${code}. Ele vale por ${minutes} minutos e só funciona nesta sessão. Ninguém da Eden Bowls vai pedir esse código por telefone ou mensagem.`
    : `Your Eden Bowls verification code is ${code}. It is valid for ${minutes} minutes and only works in this session. No one from Eden Bowls will ever ask for this code by phone or text message.`;

  const innerHtml = [
    paragraphHtml(pt
      ? `Para concluir seu cadastro, digite o código abaixo. Ele vale por ${minutes} minutos e só funciona nesta sessão.`
      : `To finish signing up, enter the code below. It is valid for ${minutes} minutes and only works in this session.`),
    codeWellHtml(code),
    mutedHtml(pt
      ? 'Ninguém da Eden Bowls vai pedir esse código por telefone ou mensagem.'
      : 'No one from Eden Bowls will ever ask for this code by phone or text message.')
  ].join('');

  return {
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Use o código abaixo para confirmar sua conta.' : 'Use the code below to confirm your account.',
      kicker: pt ? 'Verificação' : 'Verification',
      title: pt ? 'Confirme sua conta' : 'Confirm your account',
      innerHtml,
      assetBaseUrl,
      allowRelativeAssets
    })
  };
}

module.exports = {
  OTP_TTL_FLOOR_SECONDS,
  OTP_TTL_DEFAULT_SECONDS,
  effectiveOtpTtlSeconds,
  buildOtpEmailContent
};
