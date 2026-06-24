import { ChannelListingService } from './channel-listing.service';

// drizzle 쿼리 체인 mock: select()/insert()/update() 호출마다 큐의 다음 결과를 반환하는 thenable.
function makeClient(results: any[]) {
  let i = 0;
  const makeChain = () => {
    const result = results[i++];
    const chain: any = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit', 'values', 'returning', 'set']) {
      chain[m] = () => chain;
    }
    chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return chain;
  };
  return { select: () => makeChain(), insert: () => makeChain(), update: () => makeChain() };
}

function makeService(results: any[]) {
  const db = { db: makeClient(results) } as any;
  const productSellableQuantity = { recalculateAndPublishForVariant: jest.fn().mockResolvedValue(undefined) } as any;
  return new ChannelListingService(db, productSellableQuantity);
}

const baseDto = { variantId: 'var-1', salesChannelId: 'ch-1', channelItemId: 'item-1' } as any;

describe('ChannelListingService createListing — 외부채널 디지털 차단', () => {
  // 큐 순서: variant존재 → channel존재 → (assert)channel site → (assert)isDigitalVariant → insert
  it('외부채널(naver) + 디지털 variant 는 listing 을 차단한다', async () => {
    const service = makeService([
      [{ id: 'var-1' }],
      [{ id: 'ch-1' }],
      [{ site: 'naver' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(service.createListing(baseDto)).rejects.toThrow('디지털 상품을 지원하지 않습니다');
  });

  it('외부채널(coupang) + 물리 variant 는 listing 을 허용한다', async () => {
    const service = makeService([
      [{ id: 'var-1' }],
      [{ id: 'ch-1' }],
      [{ site: 'coupang' }],
      [{ fulfillmentKind: 'physical' }],
      [{ id: 'listing-1', variantId: 'var-1' }],
    ]);
    await expect(service.createListing(baseDto)).resolves.toMatchObject({ id: 'listing-1' });
  });

  it('medusa(자사몰) 채널은 디지털이어도 listing 을 허용한다 (외부채널 아님 → digital 조회 skip)', async () => {
    const service = makeService([
      [{ id: 'var-1' }],
      [{ id: 'ch-1' }],
      [{ site: 'medusa' }],
      [{ id: 'listing-2', variantId: 'var-1' }],
    ]);
    await expect(service.createListing(baseDto)).resolves.toMatchObject({ id: 'listing-2' });
  });
});

describe('ChannelListingService activateListing — 외부채널 디지털 재활성 차단', () => {
  // 큐 순서: getListingById → (assert)channel site → (assert)isDigitalVariant → update
  it('비활성 외부채널(naver) 디지털 listing 재활성을 차단한다', async () => {
    const service = makeService([
      [{ id: 'l-1', variantId: 'var-1', salesChannelId: 'ch-1' }],
      [{ site: 'naver' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(service.activateListing('l-1')).rejects.toThrow('디지털 상품을 지원하지 않습니다');
  });

  it('medusa 채널 listing 은 재활성을 허용한다', async () => {
    const service = makeService([
      [{ id: 'l-2', variantId: 'var-1', salesChannelId: 'ch-1' }],
      [{ site: 'medusa' }],
      [{ id: 'l-2', variantId: 'var-1' }],
    ]);
    await expect(service.activateListing('l-2')).resolves.toBeUndefined();
  });
});

describe('ChannelListingService.isExternalMarketplaceSite', () => {
  const service = makeService([]);
  it('naver/coupang 는 외부 마켓플레이스', () => {
    expect((service as any).isExternalMarketplaceSite('naver')).toBe(true);
    expect((service as any).isExternalMarketplaceSite('coupang')).toBe(true);
  });
  it('medusa/phone_order/other 는 외부 마켓플레이스가 아니다', () => {
    expect((service as any).isExternalMarketplaceSite('medusa')).toBe(false);
    expect((service as any).isExternalMarketplaceSite('phone_order')).toBe(false);
    expect((service as any).isExternalMarketplaceSite('other')).toBe(false);
  });
});
