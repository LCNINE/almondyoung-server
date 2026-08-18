import { GUARDS_METADATA } from '@nestjs/common/constants';
import { InternalKeyGuard, IS_PUBLIC_KEY } from '@app/authorization';
import { SalesChannelsInternalController } from './sales-channels-internal.controller';
import { SalesChannelsService } from './sales-channels.service';

/**
 * channel-adapter 의 폴링 게이트(#654)가 부르는 내부 라우트다. 사람 JWT 가 없으므로 전역
 * JwtAuthGuard/AdminRealmGuard 를 면제하고 공유 키로 막는다.
 *
 * 어드민용 `SalesChannelsController` 와 파일을 나눈 이유가 여기 있다 — 한 파일에 두 인증 체제가
 * 섞이면 나중에 핸들러를 더하는 사람이 어느 쪽 규칙인지 헷갈린다. 클래스 단위로 `@InternalOnly()`
 * 가 걸려 있으면 이 컨트롤러에 무엇을 더하든 보호된다.
 *
 * 활성 사이트를 뽑는 SQL(distinct) 은 같은 파일의 다른 조회들과 구조가 같아 리뷰로 검증하고,
 * 여기서는 드리즐 내부 표현을 흉내 내지 않는다 — `sales-channels.filter.spec.ts` 와 같은 방침이다.
 */
describe('SalesChannelsInternalController', () => {
  describe('라우트 보호', () => {
    it('클래스에 전역 인증 면제 표시가 있다', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, SalesChannelsInternalController)).toBe(true);
    });

    it('클래스에 InternalKeyGuard 가 바인딩돼 있다 — 면제만 되고 가드가 없으면 무인증 개방이다', () => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, SalesChannelsInternalController) as unknown[];
      expect(guards).toContain(InternalKeyGuard);
    });
  });

  describe('getActiveSites', () => {
    function controllerWithStubService(sites: string[]): SalesChannelsInternalController {
      const stub = { getActiveChannelSites: jest.fn().mockResolvedValue(sites) };
      return new SalesChannelsInternalController(stub as never as SalesChannelsService);
    }

    it('활성 사이트 목록을 sites 로 감싸 반환한다', async () => {
      const controller = controllerWithStubService(['medusa', 'naver']);

      await expect(controller.getActiveSites()).resolves.toEqual({ sites: ['medusa', 'naver'] });
    });

    it('활성 채널이 하나도 없으면 빈 배열을 반환한다', async () => {
      const controller = controllerWithStubService([]);

      await expect(controller.getActiveSites()).resolves.toEqual({ sites: [] });
    });
  });
});
