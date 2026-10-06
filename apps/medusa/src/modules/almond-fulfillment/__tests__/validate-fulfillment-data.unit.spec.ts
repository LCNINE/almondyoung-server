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

  it('옵션에 정책이 없으면 스냅샷 없이 data 를 그대로 통과시킨다 — 체크아웃을 막지 않는다', async () => {
    const out = await svc.validateFulfillmentData({}, { foo: 1 }, {} as any);
    expect(out).toEqual({ foo: 1 });
    expect(out).not.toHaveProperty('policySnapshot');
  });

  it('정책 없는 옵션에 클라이언트가 보낸 policySnapshot 은 버린다 — 부분취소가 믿는 근거를 밖에서 심지 못하게', async () => {
    const forged = { policy: { type: 'free' }, shippingGroupCode: 'x', shippingProfileId: 'sp_x' };
    const out = await svc.validateFulfillmentData({}, { foo: 1, policySnapshot: forged }, {} as any);
    expect(out).toEqual({ foo: 1 });
  });

  it('정책 있는 옵션은 클라이언트가 보낸 policySnapshot 을 옵션의 정책으로 덮어쓴다', async () => {
    const forged = { policy: { type: 'free' }, shippingGroupCode: 'x', shippingProfileId: 'sp_x' };
    const out = await svc.validateFulfillmentData(optionData, { policySnapshot: forged }, {} as any);
    expect(out.policySnapshot).toEqual({ policy: optionData.policy, shippingGroupCode: 'g1', shippingProfileId: 'sp_1' });
  });
});

