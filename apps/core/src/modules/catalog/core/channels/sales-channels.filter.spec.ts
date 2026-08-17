import { SalesChannelsController } from './sales-channels.controller';
import { SalesChannelsService } from './sales-channels.service';

/**
 * 목록 화면의 필터 드롭다운은 `site`(채널 정체: medusa/naver/coupang/3pl) 어휘로 채워지지만
 * 값은 `type`(채널 형태: ONLINE/MARKETPLACE/…) 쿼리 파라미터로 보낸다. 그래서
 * "네이버 스마트스토어로 거르기"가 항상 0행이었다 (#649 결함 1).
 *
 * 이 스펙은 실제 회귀 지점 — 컨트롤러가 쿼리 파라미터를 조용히 흘려버리는 지점 — 을 잡는다.
 * 서비스가 where 절에 `site` 조건을 더하는 한 줄은 바로 위 `type` 조건과 구조가 같아
 * 리뷰로 충분히 검증되므로, 여기서는 드리즐 내부 표현을 흉내 내지 않고
 * 컨트롤러 → 서비스로 넘어가는 filters 객체만 확인한다.
 */
describe('SalesChannelsController.getChannels — site 필터 전달', () => {
  function controllerWithStubService(): {
    controller: SalesChannelsController;
    getChannels: jest.Mock;
  } {
    const getChannels = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 });
    const stub = { getChannels };
    // 컨트롤러의 유일한 생성자 의존성은 SalesChannelsService 하나뿐이라, 부분 더블을 주입하는 통상적인 방법으로 `as never` 를 쓴다.
    const controller = new SalesChannelsController(stub as never as SalesChannelsService);

    return { controller, getChannels };
  }

  it('site 쿼리를 filters.site 로 전달한다', async () => {
    const { controller, getChannels } = controllerWithStubService();

    await controller.getChannels({ site: 'naver' });

    expect(getChannels).toHaveBeenCalledWith(expect.objectContaining({ site: 'naver' }));
  });

  it('site 쿼리가 없으면 filters.site 를 undefined 로 둔다', async () => {
    const { controller, getChannels } = controllerWithStubService();

    await controller.getChannels({});

    expect(getChannels).toHaveBeenCalledWith(expect.objectContaining({ site: undefined }));
  });

  it('type 쿼리는 여전히 filters.type 으로 전달한다', async () => {
    const { controller, getChannels } = controllerWithStubService();

    await controller.getChannels({ type: 'ONLINE' });

    expect(getChannels).toHaveBeenCalledWith(expect.objectContaining({ type: 'ONLINE', site: undefined }));
  });
});
