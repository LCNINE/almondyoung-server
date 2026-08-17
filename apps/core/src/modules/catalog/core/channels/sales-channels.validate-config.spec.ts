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

  // #650: 채널 인증의 정본은 SST Secret / env 다. `config` 에 키를 넣어도 아무도 안 읽으므로
  // "넣으라"는 신호를 주는 검사 자체를 걷어냈다. 검사가 되살아나면 이 스펙이 잡는다.
  it.each(['naver', 'coupang'])('%s 의 config 에서 인증 키를 요구하지 않는다', async (site) => {
    const result = await service.validateChannelConfig(site, {});

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
