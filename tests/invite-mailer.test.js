const { createInviteMailer } = require('../src/infrastructure/mailers/invite-mailer');
const { buildInviteEmailContent } = require('../src/core/invite-email');
const { generateTemporaryPassword } = require('../src/core/temporary-password');

describe('staff invite email', () => {
  test('uses the friendly role label and never includes a stored hash', () => {
    const content = buildInviteEmailContent({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      temporaryPassword: 'TempPassword#12345',
      roles: ['nutritionist'],
      panelUrl: 'http://localhost:5174',
      expiresAt: 1_700_000_000
    });

    expect(content.subject).toBe('Your Eden Bowls admin access');
    expect(content.text).toContain('Nutricionista');
    expect(content.text).not.toContain('nutritionist');
    expect(content.text).toContain('TempPassword#12345');
    expect(content.text).toContain('http://localhost:5174');
  });

  test('sends plaintext through the existing SMTP mailer without logging the password', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const logger = { info: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const mailer = createInviteMailer({
      otpMailer: { sendMail }
    });

    await mailer.sendInviteEmail({
      to: 'lia@edenbowls.com',
      name: 'Lia',
      temporaryPassword: 'TempPassword#12345',
      roles: ['operator'],
      panelUrl: 'http://localhost:5174',
      expiresAt: 1_700_000_000
    });

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'lia@edenbowls.com',
      subject: 'Your Eden Bowls admin access',
      text: expect.stringContaining('TempPassword#12345'),
      html: expect.stringContaining('TempPassword#12345')
    }));
    expect(JSON.stringify(logger)).not.toContain('TempPassword#12345');
  });

  test('generates a CSPRNG password of at least 16 characters', () => {
    const password = generateTemporaryPassword();
    expect(password.length).toBeGreaterThanOrEqual(16);
    expect(generateTemporaryPassword()).not.toBe(password);
  });
});
