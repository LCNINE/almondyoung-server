import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { REQUIRED_SCOPES } from '../decorators/require-scopes.decorator';

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
    const requiredScopes = this.reflector.getAllAndOverride<string[]>(
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

    return requiredScopes.every((scope) => userScopeSet.has(scope));
  }
}
