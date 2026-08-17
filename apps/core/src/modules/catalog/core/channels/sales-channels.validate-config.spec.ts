import { SalesChannelsService } from './sales-channels.service';

/**
 * `validateChannelConfig` 는 DTO 와 **별개로** site 어휘를 한 벌 더 들고 있었다. 두 벌이 갈리면
 * DTO 가 400 으로 끊은 값을 서비스는 유효하다고 답하는(또는 그 반대) 상태가 된다.
 * 이 스펙이 두 어휘가 같은 곳(`SALES_CHANNELS`)에서 오는지를 지킨다.
 *
 * 이 메서드는 DB 를 건드리지 않으므로 주입 없이 호출한다.
 */
describe('SalesChannelsService.validateChannelConfig', () => {
  // db 를 쓰지 않는 순수 분기라 주입값이 필요 없다
  const service = new SalesChannelsService(undefined as never);

  it.each(['medusa', 'naver', 'coupang', '3pl'])('SalesChannel 값 %s 를 지원한다', async (site) => {
    const result = await service.validateChannelConfig(site, undefined);
    expect(result.errors).not.toContainEqual(expect.stringContaining('Unsupported channel type'));
  });

  it.each(['phone_order', 'other', 'naver_smartstore', 'MEDUSA'])(
    '어휘 밖의 값 %s 를 지원하지 않는다고 답한다',
    async (site) => {
      const result = await service.validateChannelConfig(site, undefined);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('Unsupported channel type'));
    },
  );

  it('site 가 비면 거부한다', async () => {
    const result = await service.validateChannelConfig('', undefined);
    expect(result.isValid).toBe(false);
  });

  // 어휘 정렬이 채널별 config 요구사항 검사를 덮어쓰지 않았는지 확인한다.
  it('naver 는 clientId/clientSecret 을 요구한다', async () => {
    const result = await service.validateChannelConfig('naver', { clientId: 'x' });
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('clientId'));
  });
});
