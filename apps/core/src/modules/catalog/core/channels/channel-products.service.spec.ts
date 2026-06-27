import { ChannelProductsService } from './channel-products.service';

// drizzle 쿼리 체인 mock: select()/insert()/update() 호출마다 큐의 다음 결과를 반환하는 thenable.
function makeClient(results: any[]) {
  let i = 0;
  const makeChain = () => {
    const result = results[i++];
    const chain: any = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit', 'values', 'returning', 'set', 'orderBy']) {
      chain[m] = () => chain;
    }
    chain.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
    return chain;
  };
  return { select: () => makeChain(), insert: () => makeChain(), update: () => makeChain() };
}

function makeService(results: any[]) {
  const client = makeClient(results);
  const db = { db: client, run: (fn: any, t?: any) => (t ? fn(t) : fn(client)) } as any;
  const productReadAssembler = {} as any;
  const productSellableQuantity = {
    recalculateAndPublishForMaster: jest.fn().mockResolvedValue(undefined),
  } as any;
  // tx 를 명시적으로 넘겨 모든 쿼리를 동일 mock client(큐) 로 라우팅한다.
  const service = new ChannelProductsService(db, productReadAssembler, productSellableQuantity);
  return { service, client };
}

describe('ChannelProductsService — 외부채널 디지털 master 차단', () => {
  it('createChannelProduct: 외부채널(naver) + 디지털 master 는 차단한다', async () => {
    // master존재 → channel존재 → (assert)site → (assert)master digital
    const { service, client } = makeService([
      [{ id: 'm1' }],
      [{ id: 'ch' }],
      [{ site: 'naver' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(
      service.createChannelProduct({ masterId: 'm1', channelId: 'ch' } as any, client as any),
    ).rejects.toThrow('디지털 상품을 지원하지 않습니다');
  });

  it('createChannelProduct: medusa 채널은 디지털이어도 허용한다', async () => {
    // master → channel → site(medusa, 외부아님) → dup(없음) → insert
    const { service, client } = makeService([
      [{ id: 'm1' }],
      [{ id: 'ch' }],
      [{ site: 'medusa' }],
      [{ count: 0 }],
      [{ id: 'cp-1', masterId: 'm1', channelId: 'ch' }],
    ]);
    await expect(
      service.createChannelProduct({ masterId: 'm1', channelId: 'ch' } as any, client as any),
    ).resolves.toMatchObject({ id: 'cp-1' });
  });

  it('setChannelProductActive(true): 외부채널(coupang) + 디지털 master 는 차단한다', async () => {
    // getChannelProduct → (assert)site → (assert)master digital
    const { service, client } = makeService([
      [{ id: 'cp-1', masterId: 'm1', channelId: 'ch' }],
      [{ site: 'coupang' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(service.setChannelProductActive('cp-1', true, client as any)).rejects.toThrow(
      '디지털 상품을 지원하지 않습니다',
    );
  });

  it('bulkCreateChannelProducts: 외부채널(naver) + 디지털 master 는 차단한다', async () => {
    // master존재 → channels존재 → (assert)site → (assert)master digital
    const { service, client } = makeService([
      [{ id: 'm1' }],
      [{ id: 'ch' }],
      [{ site: 'naver' }],
      [{ fulfillmentKind: 'digital' }],
    ]);
    await expect(
      service.bulkCreateChannelProducts('m1', [{ channelId: 'ch' }], client as any),
    ).rejects.toThrow('디지털 상품을 지원하지 않습니다');
  });
});
