import { ChannelListingService } from './channel-listing.service';
import { isExternalMarketplaceSite } from './marketplace-site';

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
  // 큐 순서: variant존재 → activeVersion매핑 → channel존재 → (assert)channel site → (assert)isDigitalVariant → insert
  it('외부채널(naver) + 디지털 variant 는 listing 을 차단한다', async () => {
    const service = makeService([
      [{ id: 'var-1' }],
      [{ status: 'active' }],
      [{ id: 'ch-1' }],
      [{ site: 'naver' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(service.createListing(baseDto)).rejects.toThrow('디지털 상품을 지원하지 않습니다');
  });

  it('외부채널(coupang) + 물리 variant 는 listing 을 허용한다', async () => {
    const service = makeService([
      [{ id: 'var-1' }],
      [{ status: 'active' }],
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
      [{ status: 'active' }],
      [{ id: 'ch-1' }],
      [{ site: 'medusa' }],
      [{ id: 'listing-2', variantId: 'var-1' }],
    ]);
    await expect(service.createListing(baseDto)).resolves.toMatchObject({ id: 'listing-2' });
  });
});

describe('ChannelListingService activateListing — 외부채널 디지털 재활성 차단', () => {
  // 큐 순서: getListingById → activeVersion매핑 → (assert)channel site → (assert)isDigitalVariant → update
  it('비활성 외부채널(naver) 디지털 listing 재활성을 차단한다', async () => {
    const service = makeService([
      [{ id: 'l-1', variantId: 'var-1', salesChannelId: 'ch-1' }],
      [{ status: 'active' }],
      [{ site: 'naver' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(service.activateListing('l-1')).rejects.toThrow('디지털 상품을 지원하지 않습니다');
  });

  it('medusa 채널 listing 은 재활성을 허용한다', async () => {
    const service = makeService([
      [{ id: 'l-2', variantId: 'var-1', salesChannelId: 'ch-1' }],
      [{ status: 'active' }],
      [{ site: 'medusa' }],
      [{ id: 'l-2', variantId: 'var-1' }],
    ]);
    await expect(service.activateListing('l-2')).resolves.toBeUndefined();
  });
});

describe('isExternalMarketplaceSite', () => {
  it('naver/coupang 는 외부 마켓플레이스', () => {
    expect(isExternalMarketplaceSite('naver')).toBe(true);
    expect(isExternalMarketplaceSite('coupang')).toBe(true);
  });
  it('medusa/3pl 은 외부 마켓플레이스가 아니다', () => {
    expect(isExternalMarketplaceSite('medusa')).toBe(false);
    expect(isExternalMarketplaceSite('3pl')).toBe(false);
  });
});

describe('ChannelListingService — publish 되지 않은 품목 리스팅 차단 (#652)', () => {
  // draft 에만 매달린 variant 에 리스팅을 걸면, 그 draft 를 버릴 때 variant 가 삭제되고
  // channel_variant_listings.variant_id 의 cascade 로 리스팅이 조용히 사라진다.
  it('createListing: draft 에만 매달린 variant 는 거부한다', async () => {
    // 큐: variant존재 → 버전 상태들(draft 뿐)
    const service = makeService([[{ id: 'var-1' }], [{ status: 'draft' }]]);
    await expect(service.createListing(baseDto)).rejects.toThrow('publish');
  });

  // hardDelete 가 버전 행을 지우면 매핑만 사라지고 variant 는 남는다(라이브에 4건 실재).
  // 그 품목은 publish 할 방법이 없으므로 "publish 하세요" 안내는 막다른 길이다.
  it('createListing: 어떤 버전에도 안 매달린 고아 variant 는 그 사실을 알린다', async () => {
    const service = makeService([[{ id: 'var-1' }], []]);
    await expect(service.createListing(baseDto)).rejects.toThrow('속하지');
  });

  it('activateListing: draft 에만 매달린 variant 는 재활성을 거부한다', async () => {
    const service = makeService([[{ id: 'l-1', variantId: 'var-1', salesChannelId: 'ch-1' }], [{ status: 'draft' }]]);
    await expect(service.activateListing('l-1')).rejects.toThrow('publish');
  });

  // publish 로 품목이 교체된 낡은 매핑은 "미publish" 와 원인도 복구법도 다르다.
  // 그 매핑은 활성화도 재생성도(uq_channel_variant_listing) 막히므로 삭제 후 재등록이 유일한 길이다.
  it('createListing: 버전 매핑은 있으나 active 가 없으면 낡은 매핑이라고 알린다', async () => {
    const service = makeService([[{ id: 'var-1' }], [{ status: 'inactive' }]]);
    await expect(service.createListing(baseDto)).rejects.toThrow('삭제');
  });

  it('activateListing: 낡은 매핑은 삭제 후 재등록을 안내한다', async () => {
    const service = makeService([
      [{ id: 'l-1', variantId: 'var-1', salesChannelId: 'ch-1' }],
      [{ status: 'inactive' }],
    ]);
    await expect(service.activateListing('l-1')).rejects.toThrow('삭제');
  });
});
