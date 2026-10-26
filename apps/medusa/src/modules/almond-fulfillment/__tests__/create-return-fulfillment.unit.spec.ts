import { AlmondFulfillmentProviderService } from '../service';

describe('createReturnFulfillment', () => {
  it('빈 결과를 돌려준다 — 반품 요청 확정이 반품 fulfillment 를 만들 수 있게(회수 접수는 core 가 한진에 한다)', async () => {
    const svc = new AlmondFulfillmentProviderService({} as any);
    await expect(svc.createReturnFulfillment({} as any)).resolves.toEqual({ data: {}, labels: [] });
  });
});
