import { AlmondFulfillmentProviderService } from '../service';

describe('validateFulfillmentData', () => {
  const svc = new AlmondFulfillmentProviderService({} as any);
  const optionData = {
    shippingGroupCode: 'g1',
    shippingProfileId: 'sp_1',
    policy: { type: 'conditional_free', baseFee: 3000, freeThreshold: 50000, jejuExtraFee: 3000, islandExtraFee: 5000 },
  };

  it('주문 시점 정책을 배송 방법 data 에 스냅샷으로 남긴다 — 부분취소 배송비 재계산의 근거', async () => {
    const out = await svc.validateFulfillmentData(optionData, { foo: 1 }, {} as any);
    expect(out).toEqual({ foo: 1, policySnapshot: { policy: optionData.policy, shippingGroupCode: 'g1', shippingProfileId: 'sp_1' } });
  });

  it('옵션에 정책이 없으면 지금처럼 거절한다', async () => {
    await expect(svc.validateFulfillmentData({}, {}, {} as any)).rejects.toThrow();
  });
});
