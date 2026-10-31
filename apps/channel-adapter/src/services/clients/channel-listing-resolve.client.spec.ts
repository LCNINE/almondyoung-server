import { outboundTenantForTesting } from '@app/tenancy';
import { Observable, of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { ChannelListingClient } from './channel-listing.client';

/**
 * core 의 리스팅 해석은 내부 키 입구다 — 키와 테넌트 헤더를 싣는다. 무인증 `@Public` 이던 때의 «401·404 면 `/lookup` 폴백»은
 * 없앴다: 이제 401 은 «옛 Core» 가 아니라 «키가 틀렸다» 이고, 그걸 폴백으로 삼키면 모든 라인이 조용히 미식별이 된다.
 */
describe('ChannelListingClient.resolveByChannelCode (#674)', () => {
  const listing = {
    masterId: 'm1',
    versionId: 'v1',
    productName: '상품',
    variantId: 'var1',
    variantCode: null,
    variantName: null,
    isActive: true,
  };

  function clientWith(get: jest.Mock, values: Record<string, string | undefined> = { CORE_INTERNAL_KEY: 'k' }) {
    const http = { get } as unknown as HttpService;
    const config = {
      get: (key: string) => ({ PIM_API_URL: 'http://core.test', ...values })[key],
    } as unknown as ConfigService;
    return new ChannelListingClient(http, config, outboundTenantForTesting('1'));
  }

  it('내부 키와 테넌트 헤더로 core 의 내부 해석 라우트를 부른다', async () => {
    // 인자 타입을 선언해야 mock.calls[0][1] 이 타입 검사를 지난다
    const get = jest
      .fn<Observable<{ status: number; data: unknown }>, [string, unknown]>()
      .mockReturnValue(of({ status: 200, data: { found: true, listing } }));

    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');

    expect(result).toEqual({ found: true, listing });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('http://core.test/internal/channel-listings/resolve');
    expect(get.mock.calls[0][1]).toMatchObject({
      params: { channelCode: 'naver', channelItemId: 'item-1' },
      headers: { Authorization: 'Bearer k', 'x-tenant-id': '1' },
    });
  });

  it('실패 사유를 그대로 전달한다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: false, cause: 'variant_inactive' } }));
    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');
    expect(result).toEqual({ found: false, cause: 'variant_inactive' });
  });

  it('모르는 사유는 unknown 으로 낮춘다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: false, cause: 'from_the_future' } }));
    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');
    expect(result).toEqual({ found: false, cause: 'unknown' });
  });

  it('401 은 폴백하지 않고 던진다 — 키가 틀린 것을 미식별로 바꾸지 않는다', async () => {
    const get = jest.fn().mockReturnValueOnce(throwError(() => ({ response: { status: 401 }, message: '401' })));
    await expect(clientWith(get).resolveByChannelCode('naver', 'item-1')).rejects.toBeDefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('키가 없으면 부르지 않고 던진다', async () => {
    const get = jest.fn();
    await expect(clientWith(get, {}).resolveByChannelCode('naver', 'item-1')).rejects.toThrow('CORE_INTERNAL_KEY');
    expect(get).not.toHaveBeenCalled();
  });

  it('found=true 인데 listing 이 없으면 Core 응답 오류로 던진다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: true } }));
    await expect(clientWith(get).resolveByChannelCode('naver', 'item-1')).rejects.toThrow(
      /Core.*resolve.*found=true.*listing/,
    );
  });
});
