import { ChannelLineIdentityResolver } from './channel-line-identity.resolver';
import type { ChannelListingClient } from '../clients/channel-listing.client';
import type { ChannelOrderLineSnapshot } from './channel-order-source.interface';

/**
 * 해석 실패는 예외가 아니라 **사유를 실은 값**이다 (#674). 전에는 `null` 이라 호출자가
 * "왜" 를 알 수 없었고, 격리 행에는 사유가 한 종류뿐이라 운영자도 알 수 없었다.
 */
describe('ChannelLineIdentityResolver 사유 (#674)', () => {
  function line(overrides: Partial<ChannelOrderLineSnapshot> = {}): ChannelOrderLineSnapshot {
    return {
      channelOrderItemId: 'L1',
      productName: '테스트 상품',
      quantity: 1,
      unitPrice: 1000,
      ...overrides,
    } as ChannelOrderLineSnapshot;
  }

  function resolverWith(resolveByChannelCode: jest.Mock): ChannelLineIdentityResolver {
    return new ChannelLineIdentityResolver({ resolveByChannelCode } as unknown as ChannelListingClient);
  }

  it('embedded 채널에서 식별자 3종이 없으면 no_embedded_ids', async () => {
    const resolver = resolverWith(jest.fn());
    const result = await resolver.resolve('medusa', line({ embeddedVariantId: 'v1' }));
    expect(result).toEqual({ identified: false, cause: 'no_embedded_ids' });
  });

  it('embedded 채널에서 식별자 3종이 다 있으면 식별된다', async () => {
    const resolver = resolverWith(jest.fn());
    const result = await resolver.resolve(
      'medusa',
      line({ embeddedVariantId: 'v1', embeddedMasterId: 'm1', embeddedVersionId: 'ver1' }),
    );
    expect(result.identified).toBe(true);
  });

  it('리스팅 채널에서 조회 키가 없으면 no_lookup_key — Core 를 부르지 않는다', async () => {
    const resolveByChannelCode = jest.fn();
    const resolver = resolverWith(resolveByChannelCode);
    const result = await resolver.resolve('naver', line({ channelOrderItemId: '', channelProductId: '' }));
    expect(result).toEqual({ identified: false, cause: 'no_lookup_key' });
    expect(resolveByChannelCode).not.toHaveBeenCalled();
  });

  it('Core 가 준 사유를 그대로 올린다', async () => {
    const resolveByChannelCode = jest.fn().mockResolvedValue({ found: false, cause: 'variant_inactive' });
    const resolver = resolverWith(resolveByChannelCode);
    const result = await resolver.resolve('naver', line({ channelProductId: 'P1' }));
    expect(result).toEqual({ identified: false, cause: 'variant_inactive' });
  });
});
