import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { UserScope } from '@packages/auth-constants';
import { SCOPES_KEY } from '../decorators/scopes.decorator';

export interface JwtPayload {
  email: string;
  id: string;
  scopes: string[];
  login_id?: string;
}

//todo 룰 가드로 변경
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 요구 스코프 확인
    const requiredScopes = this.reflector.getAllAndOverride<UserScope[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes || requiredScopes.length === 0) {
      // 스코프 요구가 없다면 통과
      return true;
    }

    // 사용자/JWT 확인
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request['user'];

    if (!user || !user.id || !user.scopes) {
      return false;
    }

    // 사용자의 스코프 집합
    const userScopes = new Set(user.scopes);

    // master 스코프가 있으면 바로 통과
    if (userScopes.has('master')) {
      return true;
    }

    // required 스코프 중 하나라도 가지고 있으면 통과
    return requiredScopes.some((scope) => userScopes.has(scope));
  }
}
