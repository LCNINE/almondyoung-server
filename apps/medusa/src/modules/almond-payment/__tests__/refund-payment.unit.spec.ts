import { AlmondPaymentProviderService } from '../service';

const makeService = () =>
  new AlmondPaymentProviderService({}, { walletBaseUrl: 'http://wallet.test', walletApiKey: 'k' } as any);

describe('almond-payment refundPayment', () => {
  it('Medusa 의 환불 id 로 결정적 Idempotency-Key 를 보내고, wallet 환불 id 를 data 에 남긴다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ intentId: 'i1', refunds: [{ id: 'wr1' }] });

    const out = await svc.refundPayment({ data: { intentId: 'i1' }, amount: 3000, context: { idempotency_key: 'ref_m1' } } as any);

    expect(spy).toHaveBeenCalledWith(
      '/v1/payment-intents/i1/refund',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Idempotency-Key': 'medusa-refund:ref_m1' },
        body: JSON.stringify({ amount: 3000, reasonCode: 'MEDUSA_REFUND' }),
      }),
    );
    expect(out.data).toEqual({ intentId: 'i1', walletRefundIds: ['wr1'] });
  });

  it('외부 환불 표식이 있고 금액이 같으면 wallet 을 부르지 않고 표식을 지우며 그 id 를 기록한다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch');

    const out = await svc.refundPayment({
      data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 5000 } },
      amount: 5000,
      context: { idempotency_key: 'ref_m2' },
    } as any);

    expect(spy).not.toHaveBeenCalled();
    // 표식은 null 로 쓴다: Medusa 가 JSON 컬럼을 병합 갱신하므로 키를 빼면 남는다
    expect(out.data).toEqual({ intentId: 'i1', externalRefund: null, walletRefundIds: ['wr7'] });
  });

  it('raw amount 객체여도 변환된 금액으로 표식과 비교한다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch');
    const out = await svc.refundPayment({
      data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 5000 } },
      amount: { value: '5000', precision: 20 },
    } as any);
    expect(spy).not.toHaveBeenCalled();
    // 표식은 null 로 쓴다: Medusa 가 JSON 컬럼을 병합 갱신하므로 키를 빼면 남는다
    expect(out.data).toEqual({ intentId: 'i1', externalRefund: null, walletRefundIds: ['wr7'] });
  });

  it('표식 금액과 환불 금액이 다르면 표식을 무시하고 wallet 을 부른다(다른 환불이 끼어든 것)', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [{ id: 'wr2' }] });
    await svc.refundPayment({
      data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 5000 } },
      amount: 1000,
      context: { idempotency_key: 'ref_m3' },
    } as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('idempotency_key 가 없으면 지금처럼 키를 만들게 둔다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [] });
    await svc.refundPayment({ data: { intentId: 'i1' }, amount: 1000 } as any);
    expect((spy.mock.calls[0][1] as any).headers).toBeUndefined();
  });
});
