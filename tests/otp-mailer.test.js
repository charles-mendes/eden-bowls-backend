const { createOtpMailer } = require('../src/infrastructure/mailers/otp-mailer');
const { buildOtpEmailContent, effectiveOtpTtlSeconds } = require('../src/core/otp-email');

describe('OTP email content', () => {
  test('uses the WordPress plaintext subject and 15-minute copy', () => {
    expect(buildOtpEmailContent({ otp: '847291', expiresInSeconds: 900 })).toEqual({
      subject: 'Your verification code',
      text: 'Your Eden Bowls verification code is 847291. This code expires in 15 minutes.'
    });
  });

  test('applies the 900s floor used by HSR_ACTIVATION_TTL', () => {
    expect(effectiveOtpTtlSeconds(600)).toBe(900);
    expect(effectiveOtpTtlSeconds(1200)).toBe(1200);
  });
});

describe('OTP mailer', () => {
  test('sends plaintext OTP mail through SMTP without logging the code or password', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const mailer = createOtpMailer({
      logger,
      nodeEnv: 'development',
      smtp: {
        host: 'smtp-relay.brevo.com',
        port: 587,
        user: 'smtp-user',
        pass: 'smtp-secret',
        encryption: 'tls',
        from: 'noreply@example.com',
        fromName: 'Eden Bowls'
      },
      createTransport: () => ({ sendMail })
    });

    await mailer.sendOtpEmail({ to: 'jane@example.com', otp: '847291', expiresInSeconds: 900 });

    expect(sendMail).toHaveBeenCalledWith({
      from: { name: 'Eden Bowls', address: 'noreply@example.com' },
      to: 'jane@example.com',
      subject: 'Your verification code',
      text: 'Your Eden Bowls verification code is 847291. This code expires in 15 minutes.'
    });

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('847291');
    expect(logged).not.toContain('smtp-secret');
    expect(logged).toContain('Your verification code');
  });

  test('fails closed in production when SMTP host is empty', async () => {
    const mailer = createOtpMailer({ nodeEnv: 'production', smtp: {} });

    await expect(mailer.sendOtpEmail({
      to: 'jane@example.com',
      otp: '847291',
      expiresInSeconds: 900
    })).rejects.toThrow('OTP mailer is not configured.');
  });

  test('logs SMTP failure without the message body', async () => {
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const mailer = createOtpMailer({
      logger,
      smtp: { host: 'smtp-relay.brevo.com', from: 'noreply@example.com' },
      createTransport: () => ({
        sendMail: jest.fn().mockRejectedValue(Object.assign(new Error('relay down'), { code: 'EENVELOPE' }))
      })
    });

    await expect(mailer.sendOtpEmail({
      to: 'jane@example.com',
      otp: '847291',
      expiresInSeconds: 900
    })).rejects.toThrow('relay down');

    expect(logger.error).toHaveBeenCalledWith(
      { to: 'jane@example.com', subject: 'Your verification code', code: 'EENVELOPE' },
      'OTP email failed.'
    );
  });
});
