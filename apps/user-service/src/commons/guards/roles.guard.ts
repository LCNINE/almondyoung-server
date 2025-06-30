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

    //  사용자의 역할 조회 (만료되지 않은 역할만)
    const userRoles = await this.dbService.db
      .select({
        roleId: schema.userRoleAssignments.roleId,
      })
      .from(schema.userRoleAssignments)
      .where(
        and(
          eq(schema.userRoleAssignments.userId, user.sub),
          isNull(schema.userRoleAssignments.expiresAt),
        ),
      );
    console.log('userRoles:', userRoles);
    if (!userRoles.length) {
      return false;
    }

    //  역할에 할당된 스코프 조회
    const roleIds = userRoles.map((role) => role.roleId);
    const roleScopes = await this.dbService.db
      .select({
        scopeName: schema.scopes.scopeName,
      })
      .from(schema.roleScopes)
      .leftJoin(
        schema.scopes,
        eq(schema.roleScopes.scopeId, schema.scopes.scopeId),
      )
      .where(inArray(schema.roleScopes.roleId, roleIds));

    // 사용자가 가진 모든 스코프를 Set으로 변환
    const userScopes = new Set(roleScopes.map((scope) => scope.scopeName));
    console.log('userScopes:', userScopes);
    //  필요한 모든 스코프를 가지고 있는지 확인
    return requiredScopes.every((scope) => userScopes.has(scope));
  }
}
