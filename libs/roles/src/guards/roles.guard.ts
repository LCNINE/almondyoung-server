import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { REQUIRED_SCOPES } from '../decorators/require-scopes.decorator';
import { UserScope } from '../constants/scopes.constant';

export interface JwtPayload {
  sub: string;
  email: string;
  scopes: string[];
}

@Injectable()
export class RolesGuard implements CanActivate {
  private reflector: Reflector;

  constructor() {
    this.reflector = new Reflector();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredScopes = this.reflector.getAllAndOverride<UserScope[]>(
      REQUIRED_SCOPES,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredScopes) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const user = request['user'] as JwtPayload;

    if (!user || !user.sub || !user.scopes) {
      return false;
    }

    const userScopeSet = new Set(user.scopes);

    if (userScopeSet.has('master')) {
      return true;
    }

    // 필요한 스코프 중 하나라도 있으면 통과
    return requiredScopes.some((scope) => userScopeSet.has(scope));
  }
}
