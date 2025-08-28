import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from 'apps/user-service/src/constants/public.decorator';
import { FastifyRequest } from 'fastify';
import { UserScope } from '../constants';
import { SCOPES_KEY } from '../decorators/scopes.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  scopes: string[];
}

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 퍼블릭이면 바로 통과
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // 요구 스코프 확인
    const requiredScopes = this.reflector.getAllAndOverride<UserScope[]>(
      SCOPES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredScopes || requiredScopes.length === 0) {
      // 스코프 요구가 없다면 이 가드 관점에서는 통과
      return true;
    }

    // 사용자/JWT 확인
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request['user'] as JwtPayload | undefined;
    if (!user || !user.sub || !user.scopes) {
      return false;
    }

    // 사용자의 스코프 집합
    const have = new Set(user.scopes);

    // master면 바로통과
    if (have.has('master')) return true;

    // master가 아닌 경우, master를 제외한 모든 required 스코프를 가지고 있어야 통과
    const nonMasterScopes = requiredScopes.filter(
      (scope) => scope !== 'master',
    );
    return nonMasterScopes.every((s) => have.has(s));
  }
}
