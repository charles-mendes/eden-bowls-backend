const { createOtpMailer } = require('./otp-mailer');
const { buildInviteEmailContent } = require('../../core/invite-email');

function createInviteMailer(options = {}) {
  const otpMailer = options.otpMailer || createOtpMailer(options);
  const emailAssetBaseUrl = options.emailAssetBaseUrl || '';

  async function sendInviteEmail(payload = {}) {
    const recipient = String(payload.to || payload.email || '').trim();
    if (!recipient) {
      throw new Error('Invite recipient is missing.');
    }

    const content = buildInviteEmailContent({
      name: payload.name,
      email: recipient,
      temporaryPassword: payload.temporaryPassword,
      roles: payload.roles,
      panelUrl: payload.panelUrl,
      expiresAt: payload.expiresAt,
      assetBaseUrl: emailAssetBaseUrl
    });

    return otpMailer.sendMail({
      to: recipient,
      subject: content.subject,
      text: content.text,
      html: content.html
    });
  }

  return {
    sendInviteEmail
  };
}

module.exports = {
  createInviteMailer
};
