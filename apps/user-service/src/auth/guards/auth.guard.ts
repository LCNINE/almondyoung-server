import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES } from '../decorators/require-scopes.decorator';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (!request.auth || !request.auth.user) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    const requiredScopes = this.reflector.get<string[]>(
      REQUIRED_SCOPES,
      context.getHandler(),
    );

    if (!requiredScopes) {
      return true;
    }

    const userScopes = request.auth.user.scopes || [];
    const hasAllRequiredScopes = requiredScopes.every((scope) =>
      userScopes.includes(scope),
    );

    if (!hasAllRequiredScopes) {
      throw new UnauthorizedException('권한이 부족합니다.');
    }

    return true;
  }
}
