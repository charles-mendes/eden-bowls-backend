import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let service: {
    register: jest.Mock;
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
  };
  let controller: AuthController;

  beforeEach(() => {
    service = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
    };
    controller = new AuthController(service as unknown as AuthService);
  });

  it('register should delegate to service', async () => {
    service.register.mockResolvedValue({ accessToken: 'a' });

    const output = await controller.register({ email: 'john@example.com', password: 'secret123' });

    expect(service.register).toHaveBeenCalledWith({ email: 'john@example.com', password: 'secret123' });
    expect(output).toEqual({ accessToken: 'a' });
  });

  it('login should delegate to service', async () => {
    service.login.mockResolvedValue({ accessToken: 'a' });

    const output = await controller.login({ email: 'john@example.com', password: 'secret123' });

    expect(service.login).toHaveBeenCalledWith({ email: 'john@example.com', password: 'secret123' });
    expect(output).toEqual({ accessToken: 'a' });
  });

  it('refresh should delegate to service', async () => {
    service.refresh.mockResolvedValue({ accessToken: 'a' });

    const output = await controller.refresh({ refreshToken: 'refresh-token' });

    expect(service.refresh).toHaveBeenCalledWith({ refreshToken: 'refresh-token' });
    expect(output).toEqual({ accessToken: 'a' });
  });

  it('logout should delegate to service', async () => {
    service.logout.mockResolvedValue({ success: true });

    const output = await controller.logout({ refreshToken: 'refresh-token' });

    expect(service.logout).toHaveBeenCalledWith({ refreshToken: 'refresh-token' });
    expect(output).toEqual({ success: true });
  });

  it('me should return the current user', () => {
    const output = controller.me({ userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });

    expect(output).toEqual({ userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] });
  });

  it('adminOnly should return ok and current user', () => {
    const user = { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] };

    const output = controller.adminOnly(user);

    expect(output).toEqual({ ok: true, user });
  });
});
