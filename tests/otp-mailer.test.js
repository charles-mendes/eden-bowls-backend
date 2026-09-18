const { createOtpMailer } = require('../src/infrastructure/mailers/otp-mailer');
const { buildOtpEmailContent, effectiveOtpTtlSeconds } = require('../src/core/otp-email');

describe('OTP email content', () => {
  test('defaults to Portuguese HTML with the 15-minute code', () => {
    const content = buildOtpEmailContent({ otp: '847291', expiresInSeconds: 900 });

    expect(content.subject).toBe('Seu código de verificação Eden Bowls');
    expect(content.text).toBe('Seu código de verificação Eden Bowls é 847291. Ele expira em 15 minutos.');
    expect(content.html).toContain('847291');
    expect(content.html).toContain('#7B876F');
  });

  test('keeps English copy when locale is en', () => {
    expect(buildOtpEmailContent({
      otp: '847291',
      expiresInSeconds: 900,
      locale: 'en-US'
    })).toEqual(expect.objectContaining({
      subject: 'Your Eden Bowls verification code',
      text: 'Your Eden Bowls verification code is 847291. This code expires in 15 minutes.'
    }));
  });

  test('applies the 900s floor used by HSR_ACTIVATION_TTL', () => {
    expect(effectiveOtpTtlSeconds(600)).toBe(900);
    expect(effectiveOtpTtlSeconds(1200)).toBe(1200);
  });
});

describe('OTP mailer', () => {
  test('sends HTML and plaintext OTP mail without logging the code or password', async () => {
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

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: { name: 'Eden Bowls', address: 'noreply@example.com' },
      to: 'jane@example.com',
      subject: 'Seu código de verificação Eden Bowls',
      text: expect.stringContaining('847291'),
      html: expect.stringContaining('847291')
    }));

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain('847291');
    expect(logged).not.toContain('smtp-secret');
    expect(logged).toContain('Seu código de verificação Eden Bowls');
  });

  test('fails closed in production when SMTP host is empty', async () => {
    const mailer = createOtpMailer({ nodeEnv: 'production', smtp: {} });

    await expect(mailer.sendOtpEmail({
      to: 'jane@example.com',
      otp: '847291',
      expiresInSeconds: 900
    })).rejects.toThrow('Mailer is not configured.');
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
      { to: 'jane@example.com', subject: 'Seu código de verificação Eden Bowls', code: 'EENVELOPE' },
      'Email failed.'
    );
  });
});
