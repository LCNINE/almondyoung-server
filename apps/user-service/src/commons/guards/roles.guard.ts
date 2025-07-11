import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_SCOPES } from '../decorators/require-scopes.decorator';
import { DbService, InjectDb } from '@app/db';
import { FastifyRequest } from 'fastify';
import * as schema from '../../../database/drizzle/schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectDb() private readonly dbService: DbService<Record<string, unknown>>,
  ) {}

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

    const userScopes = await this.dbService.db
      .select({
        scope_name: schema.scopes.scopeName,
      })
      .from(schema.userRoleAssignments)
      .where(
        and(
          eq(schema.userRoleAssignments.userId, user.sub),
          isNull(schema.userRoleAssignments.expiresAt),
        ),
      )
      .leftJoin(
        schema.roles,
        eq(schema.userRoleAssignments.roleId, schema.roles.roleId),
      )
      .leftJoin(
        schema.roleScopes,
        eq(schema.roles.roleId, schema.roleScopes.roleId),
      )
      .leftJoin(
        schema.scopes,
        eq(schema.roleScopes.scopeId, schema.scopes.scopeId),
      );

    const userScopeSet = new Set(userScopes.map((scope) => scope.scope_name));

    return requiredScopes.every((scope) => userScopeSet.has(scope));
  }
}
