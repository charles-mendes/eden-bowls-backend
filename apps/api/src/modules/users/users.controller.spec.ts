import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let service: {
    getMe: jest.Mock;
    upsertMyProfile: jest.Mock;
    listMyAddresses: jest.Mock;
    createMyAddress: jest.Mock;
    updateMyAddress: jest.Mock;
    deleteMyAddress: jest.Mock;
    listUsers: jest.Mock;
  };
  let controller: UsersController;

  beforeEach(() => {
    service = {
      getMe: jest.fn(),
      upsertMyProfile: jest.fn(),
      listMyAddresses: jest.fn(),
      createMyAddress: jest.fn(),
      updateMyAddress: jest.fn(),
      deleteMyAddress: jest.fn(),
      listUsers: jest.fn(),
    };
    controller = new UsersController(service as unknown as UsersService);
  });

  it('me should delegate to getMe', async () => {
    service.getMe.mockResolvedValue({ id: 'user_1' });

    const output = await controller.me({ userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });

    expect(service.getMe).toHaveBeenCalledWith('user_1');
    expect(output).toEqual({ id: 'user_1' });
  });

  it('upsertMyProfile should delegate to service', async () => {
    service.upsertMyProfile.mockResolvedValue({ id: 'profile_1' });

    const output = await controller.upsertMyProfile(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      { fullName: 'John Doe' },
    );

    expect(service.upsertMyProfile).toHaveBeenCalledWith('user_1', { fullName: 'John Doe' });
    expect(output).toEqual({ id: 'profile_1' });
  });

  it('listMyAddresses should delegate to service', async () => {
    service.listMyAddresses.mockResolvedValue([{ id: 'addr_1' }]);

    const output = await controller.listMyAddresses({ userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });

    expect(service.listMyAddresses).toHaveBeenCalledWith('user_1');
    expect(output).toEqual([{ id: 'addr_1' }]);
  });

  it('createMyAddress should delegate to service', async () => {
    service.createMyAddress.mockResolvedValue({ id: 'addr_1' });

    const output = await controller.createMyAddress(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      { type: 'billing', country: 'BR', state: 'SP', city: 'Sao Paulo', postcode: '01310000', address1: 'Av Paulista' },
    );

    expect(service.createMyAddress).toHaveBeenCalled();
    expect(output).toEqual({ id: 'addr_1' });
  });

  it('updateMyAddress should delegate to service', async () => {
    service.updateMyAddress.mockResolvedValue({ id: 'addr_1' });

    const output = await controller.updateMyAddress(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'addr_1',
      { city: 'Sao Paulo' },
    );

    expect(service.updateMyAddress).toHaveBeenCalledWith('user_1', 'addr_1', { city: 'Sao Paulo' });
    expect(output).toEqual({ id: 'addr_1' });
  });

  it('deleteMyAddress should delegate to service', async () => {
    service.deleteMyAddress.mockResolvedValue({ success: true });

    const output = await controller.deleteMyAddress(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'addr_1',
    );

    expect(service.deleteMyAddress).toHaveBeenCalledWith('user_1', 'addr_1');
    expect(output).toEqual({ success: true });
  });

  it('listUsers should delegate to service', async () => {
    service.listUsers.mockResolvedValue({ total: 1 });

    const output = await controller.listUsers(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      { skip: 0, take: 20 },
    );

    expect(service.listUsers).toHaveBeenCalledWith({ skip: 0, take: 20 }, { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] });
    expect(output).toEqual({ total: 1 });
  });
});
