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

function buildOtpEmailContent({ otp, expiresInSeconds, locale }) {
  const minutes = Math.max(1, Math.floor(Number(expiresInSeconds || OTP_TTL_FLOOR_SECONDS) / 60));
  const code = String(otp || '').trim();
  const pt = isPortuguese(locale || 'pt-BR');

  const subject = pt ? 'Seu código de verificação Eden Bowls' : 'Your Eden Bowls verification code';
  const text = pt
    ? `Seu código de verificação Eden Bowls é ${code}. Ele expira em ${minutes} minutos.`
    : `Your Eden Bowls verification code is ${code}. This code expires in ${minutes} minutes.`;

  const innerHtml = [
    paragraphHtml(pt
      ? 'Para abrir a conta, use o código abaixo. Ele vale só nesta sessão e some da mesa em pouco tempo.'
      : 'Use the code below to open your account. It is good for this session only, and it leaves the table soon.'),
    codeWellHtml(code),
    mutedHtml(pt
      ? `Expira em ${minutes} minutos. Ninguém da Eden vai pedir esse código por telefone.`
      : `Expires in ${minutes} minutes. Eden will never ask for this code by phone.`)
  ].join('');

  return {
    subject,
    text,
    html: wrapEmailHtml({
      locale: locale || 'pt-BR',
      preheader: pt ? 'Seu código da cozinha está nesta carta.' : 'Your kitchen code is in this letter.',
      kicker: pt ? 'Verificação' : 'Verification',
      title: pt ? 'Um código, uma tigela' : 'One code, one bowl',
      innerHtml
    })
  };
}

module.exports = {
  OTP_TTL_FLOOR_SECONDS,
  OTP_TTL_DEFAULT_SECONDS,
  effectiveOtpTtlSeconds,
  buildOtpEmailContent
};
