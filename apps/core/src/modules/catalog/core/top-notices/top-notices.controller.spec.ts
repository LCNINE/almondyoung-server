import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { enforcedPermissionProvidersForTesting, JwtAuthGuard, PermissionGuard } from '@app/authorization';
import { TopNoticesController } from './top-notices.controller';

type HandlerName = keyof TopNoticesController;

function contextFor(handler: HandlerName, user?: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => TopNoticesController.prototype[handler],
    getClass: () => TopNoticesController,
    switchToHttp: () => ({ getRequest: () => ({ user, headers: {}, cookies: {} }) }),
  } as unknown as ExecutionContext;
}

describe('TopNoticesController 접근 제어', () => {
  const reflector = new Reflector();
  const jwtGuard = new JwtAuthGuard(reflector);
  const permissionGuard = enforcedPermissionProvidersForTesting()
    .map((provider) => ('useValue' in provider ? provider.useValue : undefined))
    .find((value): value is PermissionGuard => value instanceof PermissionGuard);
  if (!permissionGuard) throw new Error('PermissionGuard provider missing');

  it('공개 목록은 로그인 없이 인증 가드를 통과한다', () => {
    expect(jwtGuard.canActivate(contextFor('listPublic'))).toBe(true);
    expect(permissionGuard.canActivate(contextFor('listPublic'))).toBe(true);
  });

  const adminHandlers: HandlerName[] = ['create', 'list', 'getById', 'update', 'remove'];

  it.each(adminHandlers)('%s 는 비로그인 방문자에게 막힌다', (handler) => {
    expect(() => permissionGuard.canActivate(contextFor(handler))).toThrow(UnauthorizedException);
  });

  it.each(adminHandlers)('%s 는 일반 회원 토큰으로도 막힌다', (handler) => {
    expect(() => permissionGuard.canActivate(contextFor(handler, { roles: ['user'] }))).toThrow(ForbiddenException);
  });

  it.each(adminHandlers)('%s 는 관리자에게 열린다', (handler) => {
    expect(permissionGuard.canActivate(contextFor(handler, { roles: ['admin'] }))).toBe(true);
  });
});
