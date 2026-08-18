import { of, throwError } from 'rxjs';
import type { HttpService } from '@nestjs/axios';
import type { ConfigService } from '@nestjs/config';
import { ChannelListingClient } from './channel-listing.client';

/**
 * 배포 순서는 Core → 어댑터지만, **Core 를 롤백하면 순서가 뒤집힌다.** 그때
 * `/resolve` 는 404 다. 폴백이 없으면 그 순간 모든 라인 해석이 예외가 되어 수집이 통째로
 * 멈춘다 — 사유를 얻으려다 수집을 잃는 것은 명백한 퇴행이다 (#674).
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

  function clientWith(get: jest.Mock): ChannelListingClient {
    const http = { get } as unknown as HttpService;
    const config = { get: () => 'http://core.test' } as unknown as ConfigService;
    return new ChannelListingClient(http, config);
  }

  it('성공하면 found: true 와 매핑을 준다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: true, listing } }));
    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');
    expect(result).toEqual({ found: true, listing });
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

  it('/resolve 가 404 면 /lookup 으로 폴백한다 — 매핑이 있으면 found: true', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })))
      .mockReturnValueOnce(of({ status: 200, data: listing }));

    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');

    expect(result).toEqual({ found: true, listing });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][0]).toContain('/channel-listings/resolve');
    expect(get.mock.calls[1][0]).toContain('/channel-listings/lookup');
  });

  it('폴백에서 매핑이 없으면 사유를 지어내지 않고 unknown 이다', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ response: { status: 404 } })))
      .mockReturnValueOnce(of({ status: 204, data: null }));

    const result = await clientWith(get).resolveByChannelCode('naver', 'item-1');

    expect(result).toEqual({ found: false, cause: 'unknown' });
  });

  it('404 가 아닌 오류는 삼키지 않는다', async () => {
    const get = jest
      .fn()
      .mockReturnValueOnce(throwError(() => ({ response: { status: 500 }, message: 'boom' })));
    await expect(clientWith(get).resolveByChannelCode('naver', 'item-1')).rejects.toBeDefined();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('found=true 인데 listing 이 없으면 Core 응답 오류로 던진다', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, data: { found: true } }));
    await expect(clientWith(get).resolveByChannelCode('naver', 'item-1')).rejects.toThrow(
      /Core.*resolve.*found=true.*listing/,
    );
  });
});
