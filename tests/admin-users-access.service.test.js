const { AdminUsersService } = require('../src/services/admin-users.service');
const { parseCreateAccessInput, parseUpdateAccessInput } = require('../src/api/validators/admin-users-access.validator');

function buildService(overrides = {}) {
  const users = {
    '1': {
      id: '1',
      email: 'admin@edenbowls.com',
      status: 'active',
      storedRoles: '["admin"]',
      displayName: 'Admin',
      profile: { fullName: 'Admin', phone: null }
    },
    '2': {
      id: '2',
      email: 'ops@edenbowls.com',
      status: 'pending',
      storedRoles: '["operator"]',
      displayName: 'Ops',
      mustChangePassword: '1',
      inviteExpiresAt: String(Math.floor(Date.now() / 1000) + 3600),
      inviteMailStatus: 'failed',
      inviteResendCount: '0',
      inviteResendWindowStart: '0',
      profile: { fullName: 'Ops', phone: null }
    }
  };

  const usersRepository = {
    findUserById: jest.fn(async (userId) => users[String(userId)] || null),
    findUserIdByEmail: jest.fn(async (email) => {
      const found = Object.values(users).find((item) => item.email === email);
      return found ? found.id : null;
    }),
    listStaff: jest.fn(async () => ({ total: 1, items: [users['1']] })),
    createUser: jest.fn(async (record) => {
      users['9'] = {
        id: '9',
        email: record.userEmail,
        status: 'pending',
        storedRoles: '',
        displayName: record.displayName,
        profile: { fullName: record.displayName, phone: null }
      };
      return { id: '9', email: record.userEmail };
    }),
    saveStoredRoles: jest.fn(async (userId, roles) => {
      users[String(userId)].storedRoles = JSON.stringify(roles);
    }),
    saveStoredMarkets: jest.fn(async (userId, markets) => {
      users[String(userId)].storedMarkets = JSON.stringify(markets || []);
    }),
    saveActivationStatus: jest.fn(async (userId, status) => {
      users[String(userId)].status = status;
    }),
    upsertUserMeta: jest.fn(async (userId, key, value) => {
      const user = users[String(userId)];
      if (!user) return;
      if (key === '_eden_invite_mail_status') user.inviteMailStatus = value;
      if (key === '_eden_must_change_password') user.mustChangePassword = value;
      if (key === '_eden_invite_expires_at') user.inviteExpiresAt = value;
      if (key === '_eden_deleted_at') user.deletedAt = value;
      if (key === 'billing_phone') user.profile.phone = value;
    }),
    deleteUserMeta: jest.fn(async () => {}),
    updateDisplayName: jest.fn(async (userId, name) => {
      users[String(userId)].displayName = name;
      users[String(userId)].profile.fullName = name;
    }),
    updatePassword: jest.fn(async () => {}),
    getUserPass: jest.fn(async () => 'hashed-temp'),
    ...overrides.usersRepository
  };

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const inviteMailer = overrides.inviteMailer || {
    sendInviteEmail: jest.fn().mockResolvedValue({ skipped: false })
  };

  return {
    users,
    usersRepository,
    inviteMailer,
    auditService,
    service: new AdminUsersService({
      usersRepository,
      inviteMailer,
      auditService,
      adminEmails: overrides.adminEmails || 'bootstrap@edenbowls.com',
      adminAppUrl: 'http://localhost:5174',
      hashPassword: (value) => `hashed:${value}`,
      generatePassword: () => 'TempPassword#12345',
      nowProvider: () => 1_700_000_000,
      ...overrides.serviceOptions
    })
  };
}

const adminActor = {
  userId: '1',
  email: 'admin@edenbowls.com',
  permissions: ['users.access.write', 'users.roles.write']
};

describe('admin users access', () => {
  test('parses create and rejects immutable email on update', () => {
    expect(parseCreateAccessInput({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      role: 'nutritionist',
      market: 'US'
    })).toEqual({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      phone: '',
      roles: ['nutritionist'],
      markets: ['US']
    });

    expect(() => parseCreateAccessInput({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      role: 'operator'
    })).toThrow('Invalid request payload.');

    expect(() => parseUpdateAccessInput({ email: 'new@edenbowls.com' })).toThrow('Email cannot be changed after the account is created.');
  });

  test('creates a pending staff account, hashes the password, and emails the invite', async () => {
    const { service, usersRepository, inviteMailer, auditService, users } = buildService();
    usersRepository.findUserIdByEmail.mockResolvedValue(null);

    const result = await service.createAccess({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      phone: '11988887777',
      roles: ['nutritionist'],
      markets: ['US']
    }, adminActor);

    expect(usersRepository.createUser).toHaveBeenCalledWith(expect.objectContaining({
      userEmail: 'lia@edenbowls.com',
      userPass: 'hashed:TempPassword#12345',
      displayName: 'Lia'
    }));
    expect(usersRepository.saveActivationStatus).toHaveBeenCalledWith('9', 'pending');
    expect(usersRepository.saveStoredRoles).toHaveBeenCalledWith('9', ['nutritionist']);
    expect(usersRepository.saveStoredMarkets).toHaveBeenCalledWith('9', ['US']);
    expect(result.markets).toEqual(['US']);
    expect(inviteMailer.sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'lia@edenbowls.com',
      temporaryPassword: 'TempPassword#12345',
      panelUrl: 'http://localhost:5174'
    }));
    expect(JSON.stringify(result)).not.toContain('TempPassword#12345');
    expect(result.inviteMailStatus).toBe('sent');
    expect(result.status).toBe('pending');
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'access.create',
      metadata: expect.not.objectContaining({ temporaryPassword: expect.anything() })
    }));
    expect(users['9'].inviteMailStatus).toBe('sent');
  });

  test('keeps the account when invite email fails', async () => {
    const { service, usersRepository } = buildService({
      inviteMailer: { sendInviteEmail: jest.fn().mockRejectedValue(new Error('smtp down')) }
    });
    usersRepository.findUserIdByEmail.mockResolvedValue(null);

    const result = await service.createAccess({
      name: 'Lia',
      email: 'lia@edenbowls.com',
      phone: '',
      roles: ['operator'],
      markets: ['BR']
    }, adminActor);

    expect(result.inviteMailStatus).toBe('failed');
    expect(usersRepository.createUser).toHaveBeenCalled();
  });

  test('rejects duplicate email including deactivated accounts', async () => {
    const { service } = buildService();
    await expect(service.createAccess({
      name: 'Ops',
      email: 'ops@edenbowls.com',
      phone: '',
      roles: ['operator'],
      markets: ['BR']
    }, adminActor)).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'account_email_exists' }
    });
  });

  test('resends an invite, rotates the password, and rate limits', async () => {
    const refreshTokenRepository = { revokeAllForUser: jest.fn().mockResolvedValue(1) };
    const { service, users, usersRepository } = buildService();
    service.refreshTokenRepository = refreshTokenRepository;

    const result = await service.resendInvite('2', adminActor);
    expect(usersRepository.updatePassword).toHaveBeenCalled();
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith('2', 'invite_resent', expect.any(String));
    expect(result.inviteMailStatus).toBe('sent');

    users['2'].inviteResendCount = '3';
    users['2'].inviteResendWindowStart = String(1_700_000_000);
    await expect(service.resendInvite('2', adminActor)).rejects.toMatchObject({
      details: { code: 'invite_resend_rate_limited' }
    });
  });

  test('soft-deletes a staff account and revokes sessions', async () => {
    const refreshTokenRepository = { revokeAllForUser: jest.fn().mockResolvedValue(1) };
    const { service, usersRepository } = buildService();
    service.refreshTokenRepository = refreshTokenRepository;

    const result = await service.softDelete('2', adminActor);
    expect(usersRepository.upsertUserMeta).toHaveBeenCalledWith('2', '_eden_deleted_at', expect.any(String));
    expect(usersRepository.saveActivationStatus).toHaveBeenCalledWith('2', 'inactive');
    expect(refreshTokenRepository.revokeAllForUser).toHaveBeenCalledWith('2', 'account_deleted', expect.any(String));
    expect(result.success).toBe(true);
  });

  test('blocks deleting self or an allowlisted email', async () => {
    const { service } = buildService({ adminEmails: 'ops@edenbowls.com' });
    await expect(service.softDelete('1', adminActor)).rejects.toMatchObject({
      message: 'You cannot delete your own account.'
    });
    await expect(service.softDelete('2', adminActor)).rejects.toMatchObject({
      details: { code: 'allowlist_delete_locked' }
    });
  });
});
