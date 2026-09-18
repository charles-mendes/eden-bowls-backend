const { buildPrivacyEmailContent } = require('../../core/privacy-email');

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

      const content = buildPrivacyEmailContent({ confirmUrl, locale });

      if (!smtpMailer || typeof smtpMailer.sendMail !== 'function') {
        if (nodeEnv === 'production') {
          throw new Error('Privacy mailer is not configured.');
        }
        logger.info({ to: recipient, subject: content.subject }, 'Privacy identity email skipped (mailer missing).');
        return { skipped: true, subject: content.subject };
      }

      return smtpMailer.sendMail({
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html
      });
    }
  };
}

module.exports = {
  createPrivacyMailer
};
