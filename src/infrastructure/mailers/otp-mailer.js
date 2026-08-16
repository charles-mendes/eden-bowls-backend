const nodemailer = require('nodemailer');
const { buildOtpEmailContent } = require('../../core/otp-email');

function createSmtpTransport(smtp = {}) {
  const encryption = String(smtp.encryption || '').trim().toLowerCase();
  const authEnabled = smtp.auth !== false;
  const transport = {
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: encryption === 'ssl'
  };

  if (encryption === 'tls') {
    transport.requireTLS = true;
  }

  if (authEnabled && smtp.user) {
    transport.auth = {
      user: smtp.user,
      pass: smtp.pass || ''
    };
  }

  return nodemailer.createTransport(transport);
}

function createOtpMailer(options = {}) {
  const logger = options.logger || { debug() {}, info() {}, error() {} };
  const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
  const smtp = options.smtp || {};
  const createTransport = typeof options.createTransport === 'function'
    ? options.createTransport
    : () => createSmtpTransport(smtp);

  return {
    async sendOtpEmail({ to, otp, expiresInSeconds }) {
      const recipient = String(to || '').trim();
      if (!recipient) {
        throw new Error('OTP recipient is missing.');
      }

      const content = buildOtpEmailContent({ otp, expiresInSeconds });

      if (!String(smtp.host || '').trim()) {
        if (nodeEnv === 'production') {
          throw new Error('OTP mailer is not configured.');
        }

        logger.info({ to: recipient, subject: content.subject, expiresInSeconds }, 'OTP email skipped (SMTP host empty).');
        return { skipped: true, subject: content.subject };
      }

      const fromAddress = String(smtp.from || '').trim();
      const fromName = String(smtp.fromName || '').trim();
      const from = fromName && fromAddress
        ? { name: fromName, address: fromAddress }
        : fromAddress || undefined;

      try {
        const transporter = createTransport();
        await transporter.sendMail({
          from,
          to: recipient,
          subject: content.subject,
          text: content.text
        });
        logger.info({ to: recipient, subject: content.subject }, 'OTP email sent.');
        return { skipped: false, subject: content.subject };
      } catch (error) {
        logger.error({
          to: recipient,
          subject: content.subject,
          code: error && error.code
        }, 'OTP email failed.');
        throw error;
      }
    }
  };
}

module.exports = {
  createOtpMailer,
  createSmtpTransport
};
