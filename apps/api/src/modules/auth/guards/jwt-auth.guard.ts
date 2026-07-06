import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { AuthService } from '../auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization as string | undefined;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const token = authHeader.substring(7);

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        email: string;
        type: 'access';
      }>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });

      if (payload.type !== 'access') {
        throw new UnauthorizedException('Invalid access token');
      }

      const claims = await this.authService.getUserClaims(payload.sub);
      req.user = {
        userId: claims.userId,
        email: claims.email,
        roles: claims.roles,
        permissions: claims.permissions,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
