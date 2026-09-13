function createPrivacyMailer(options = {}) {
  const logger = options.logger || { info() {}, error() {} };
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
  const smtpMailer = options.otpMailer || null;

  return {
    async sendIdentityVerificationEmail({ to, confirmUrl, locale }) {
      const recipient = String(to || '').trim();
      if (!recipient) {
        throw new Error('Verification recipient is missing.');
      }

      const isPt = String(locale || '').toLowerCase().startsWith('pt');
      const subject = isPt
        ? 'Eden Bowls — confirme sua identidade'
        : 'Eden Bowls — confirm your identity';
      const text = isPt
        ? [
          'Recebemos um pedido de privacidade associado a esta conta.',
          'Confirme que você é o titular abrindo o link abaixo (válido uma vez):',
          confirmUrl,
          '',
          'Se você não fez este pedido, ignore este e-mail.',
          'A Eden Bowls só atende solicitações depois de confirmar o e-mail cadastrado na conta.'
        ].join('\n')
        : [
          'We received a privacy request for this account.',
          'Confirm you are the account holder by opening the one-time link below:',
          confirmUrl,
          '',
          'If you did not make this request, ignore this email.',
          'Eden Bowls only fulfills requests after confirming the email on the account.'
        ].join('\n');

      if (!smtpMailer || typeof smtpMailer.sendMail !== 'function') {
        if (nodeEnv === 'production') {
          throw new Error('Privacy mailer is not configured.');
        }
        logger.info({ to: recipient, subject }, 'Privacy identity email skipped (mailer missing).');
        return { skipped: true, subject };
      }

      return smtpMailer.sendMail({ to: recipient, subject, text });
    }
  };
}

module.exports = {
  createPrivacyMailer
};
