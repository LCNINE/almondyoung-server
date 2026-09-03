import { consumeCouponGrantsForCart, restoreConsumedCouponGrants } from '../consume-coupon-grants';

type Outcome = { outcome: 'consumed'; grant_id: string } | { outcome: 'already'; grant_id: string } | { outcome: 'none' };

function fakeService(script: Record<string, Outcome>) {
  const restored: string[][] = [];
  return {
    restored,
    consumeOneUsableGrantForCart: jest.fn(async ({ promotion_id }: { promotion_id: string }) => script[promotion_id] ?? { outcome: 'none' }),
    restoreGrants: jest.fn(async (ids: string[]) => {
      restored.push(ids);
      return ids.length;
    }),
  };
}

const input = { cart_id: 'cart_1', customer_id: 'cus_1', now: new Date('2026-09-10T00:00:00.000Z') };

describe('consumeCouponGrantsForCart — 훅의 마지막 문장', () => {
  it('잡은 장의 id 를 보상 입력으로 돌려준다', async () => {
    const service = fakeService({ p1: { outcome: 'consumed', grant_id: 'g1' }, p2: { outcome: 'consumed', grant_id: 'g2' } });
    const result = await consumeCouponGrantsForCart(service, input, [
      { promotion_id: 'p1', grants_govern: true },
      { promotion_id: 'p2', grants_govern: true },
    ]);
    expect(result).toEqual({ cart_id: 'cart_1', grant_ids: ['g1', 'g2'] });
    expect(service.restoreGrants).not.toHaveBeenCalled();
    // 배선 가드 — cart_id 가 이 PR 이 멱등성의 키로 옮긴 값이다. 인자가 빠지면 목은 그대로 통과하므로 여기서 잡는다.
    expect(service.consumeOneUsableGrantForCart).toHaveBeenCalledWith({
      promotion_id: 'p1', customer_id: 'cus_1', cart_id: 'cart_1', now: input.now,
    });
  });

  it('already 는 통과이고 보상 목록에 넣지 않는다 — 남의 실행이 잡은 장을 이번 실행이 놓으면 안 된다', async () => {
    const service = fakeService({ p1: { outcome: 'already', grant_id: 'g_prev' } });
    const result = await consumeCouponGrantsForCart(service, input, [{ promotion_id: 'p1', grants_govern: true }]);
    expect(result.grant_ids).toEqual([]);
  });

  it('장이 지배하는 쿠폰에 none 이면 이미 잡은 장을 먼저 놓고 COUPON_EXPIRED 로 던진다', async () => {
    const service = fakeService({ p1: { outcome: 'consumed', grant_id: 'g1' }, p2: { outcome: 'none' } });
    await expect(
      consumeCouponGrantsForCart(service, input, [
        { promotion_id: 'p1', grants_govern: true },
        { promotion_id: 'p2', grants_govern: true },
      ]),
    ).rejects.toMatchObject({ message: 'COUPON_EXPIRED' });
    expect(service.restored).toEqual([['g1']]);
  });

  it('장이 지배하지 않는(public) 쿠폰의 none 은 그냥 지나간다', async () => {
    const service = fakeService({ p1: { outcome: 'none' } });
    const result = await consumeCouponGrantsForCart(service, input, [{ promotion_id: 'p1', grants_govern: false }]);
    expect(result.grant_ids).toEqual([]);
  });

  it('비회원 카트는 소모하지 않는다', async () => {
    const service = fakeService({ p1: { outcome: 'consumed', grant_id: 'g1' } });
    const result = await consumeCouponGrantsForCart(service, { ...input, customer_id: null }, [{ promotion_id: 'p1', grants_govern: false }]);
    expect(result.grant_ids).toEqual([]);
    expect(service.consumeOneUsableGrantForCart).not.toHaveBeenCalled();
  });
});

describe('restoreConsumedCouponGrants — 훅 보상', () => {
  it('보상 입력의 id 를 전부 놓는다', async () => {
    const service = fakeService({});
    expect(await restoreConsumedCouponGrants(service, { cart_id: 'cart_1', grant_ids: ['g1', 'g2'] })).toBe(2);
    expect(service.restored).toEqual([['g1', 'g2']]);
  });

  it('입력이 없거나 비면(실패한 스텝 자신의 보상) 아무것도 하지 않는다', async () => {
    const service = fakeService({});
    expect(await restoreConsumedCouponGrants(service, undefined)).toBe(0);
    expect(await restoreConsumedCouponGrants(service, { cart_id: 'cart_1', grant_ids: [] })).toBe(0);
    expect(service.restoreGrants).not.toHaveBeenCalled();
  });
});
