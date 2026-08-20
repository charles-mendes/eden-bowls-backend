const { AdminUsersRepository } = require('../src/infrastructure/repositories/admin-users.repository');

describe('AdminUsersRepository', () => {
  test('lists users with created_at from the Node users schema', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{
          id: 8,
          email: 'c@d.com',
          displayName: 'Ana',
          createdAt: '2026-08-01 10:00:00',
          status: 'active',
          phone: '11999999999',
          storedRoles: '["customer"]'
        }])
    };
    const repository = new AdminUsersRepository(dataSource);
    const result = await repository.listUsers({ offset: 0, perPage: 20 });

    expect(dataSource.query.mock.calls[1][0]).toContain('u.created_at AS createdAt');
    expect(dataSource.query.mock.calls[1][0]).toContain('ORDER BY u.created_at DESC');
    expect(dataSource.query.mock.calls[1][0]).not.toContain('user_registered');
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: '8',
      email: 'c@d.com',
      status: 'active',
      createdAt: '2026-08-01 10:00:00',
      profile: { fullName: 'Ana', phone: '11999999999' }
    });
  });

  test('lists staff with created_at from the Node users schema', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([{
          id: 5,
          email: 'admin@edenbowls.com',
          displayName: 'Admin',
          createdAt: '2026-08-20 01:31:30',
          status: 'active',
          phone: null,
          storedRoles: '["admin"]'
        }])
    };
    const repository = new AdminUsersRepository(dataSource);
    const result = await repository.listStaff({
      offset: 0,
      perPage: 50,
      adminEmails: ['admin@edenbowls.com']
    });

    expect(dataSource.query.mock.calls[1][0]).toContain('u.created_at AS createdAt');
    expect(dataSource.query.mock.calls[1][0]).toContain('GROUP BY u.ID, u.user_email, u.display_name, u.created_at');
    expect(dataSource.query.mock.calls[1][0]).not.toContain('user_registered');
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: '5',
      email: 'admin@edenbowls.com',
      storedRoles: '["admin"]'
    });
  });

  test('loads a user by id using created_at', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValueOnce([{
        id: 8,
        email: 'c@d.com',
        displayName: 'Ana',
        createdAt: '2026-08-01 10:00:00',
        status: 'active',
        phone: null,
        storedRoles: ''
      }])
    };
    const repository = new AdminUsersRepository(dataSource);
    const user = await repository.findUserById(8);

    expect(dataSource.query.mock.calls[0][0]).toContain('u.created_at AS createdAt');
    expect(dataSource.query.mock.calls[0][0]).not.toContain('user_registered');
    expect(user).toMatchObject({
      id: '8',
      email: 'c@d.com',
      createdAt: '2026-08-01 10:00:00'
    });
  });

  test('persists activation status in usermeta', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({ insertId: 11 })
    };
    const repository = new AdminUsersRepository(dataSource);
    await repository.saveActivationStatus(8, 'inactive');

    expect(dataSource.query.mock.calls[0][0]).toContain('hsr_activation_status');
    expect(dataSource.query.mock.calls[1][0]).toContain('INSERT INTO');
    expect(dataSource.query.mock.calls[1][1]).toEqual([8, 'inactive']);
  });

  test('clears stored roles by user id and meta key', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValueOnce({ affectedRows: 1 })
    };
    const repository = new AdminUsersRepository(dataSource);
    await repository.saveStoredRoles(4, []);

    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][0]).toContain('DELETE FROM');
    expect(dataSource.query.mock.calls[0][0]).toContain('user_id');
    expect(dataSource.query.mock.calls[0][1]).toEqual([4, '_eden_admin_roles']);
  });
});
