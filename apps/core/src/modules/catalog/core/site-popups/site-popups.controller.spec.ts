import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRealmGuard, JwtAuthGuard } from '@app/authorization';
import { SitePopupsController } from './site-popups.controller';
import { SitePopupsService } from './site-popups.service';

type HandlerName = keyof SitePopupsController;

function contextFor(handler: HandlerName, user?: unknown): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => SitePopupsController.prototype[handler],
    getClass: () => SitePopupsController,
    switchToHttp: () => ({ getRequest: () => ({ user, headers: {}, cookies: {} }) }),
  } as unknown as ExecutionContext;
}

describe('SitePopupsController 접근 제어', () => {
  const reflector = new Reflector();
  const jwtGuard = new JwtAuthGuard(reflector);
  const realmGuard = new AdminRealmGuard(reflector);

  it('공개 목록은 로그인 없이 인증 가드를 통과한다', () => {
    expect(jwtGuard.canActivate(contextFor('listPublic'))).toBe(true);
    expect(realmGuard.canActivate(contextFor('listPublic'))).toBe(true);
  });

  const adminHandlers: HandlerName[] = ['create', 'list', 'getById', 'update', 'resetDismissals', 'remove'];

  it.each(adminHandlers)('%s 는 비로그인 방문자에게 막힌다', (handler) => {
    expect(() => realmGuard.canActivate(contextFor(handler))).toThrow(ForbiddenException);
  });

  it.each(adminHandlers)('%s 는 일반 회원 토큰으로도 막힌다', (handler) => {
    expect(() => realmGuard.canActivate(contextFor(handler, { roles: ['user'] }))).toThrow(
      ForbiddenException,
    );
  });

  it.each(adminHandlers)('%s 는 관리자에게 열린다', (handler) => {
    expect(realmGuard.canActivate(contextFor(handler, { roles: ['admin'] }))).toBe(true);
  });
});

describe('SitePopupsController 방문자 구분 해석', () => {
  function makeController() {
    const service = { listPublic: jest.fn().mockResolvedValue([]) };
    const controller = new SitePopupsController(service as unknown as SitePopupsService);
    return { controller, service };
  }

  it.each(['guest', 'member', 'membership'])('알려진 구분 %s 는 그대로 넘긴다', async (viewer) => {
    const { controller, service } = makeController();

    await controller.listPublic(viewer);

    expect(service.listPublic).toHaveBeenCalledWith(viewer);
  });

  // 브라우저가 임의로 보내는 값이라 서버가 반드시 좁혀야 한다 — 모르는 값이 멤버십 전용
  // 안내를 여는 열쇠가 되면 안 된다.
  it.each([undefined, '', 'admin', 'membership; drop table'])(
    '모르는 값(%s)은 비로그인 방문자로 본다',
    async (viewer) => {
      const { controller, service } = makeController();

      await controller.listPublic(viewer);

      expect(service.listPublic).toHaveBeenCalledWith('guest');
    },
  );
});
