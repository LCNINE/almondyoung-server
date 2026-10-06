import { AlmondPaymentProviderService } from '../service';

const makeLogger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() });
const makeService = (logger = makeLogger()) =>
  new AlmondPaymentProviderService({ logger }, { walletBaseUrl: 'http://wallet.test', walletApiKey: 'k' } as any);
const ok = (id: string, amount: number, status = 'SUCCEEDED') => ({ id, amount, status, reasonCode: 'MEDUSA_REFUND', reasonMessage: null });

describe('almond-payment refundPayment', () => {
  it('Medusa 의 환불 id 로 결정적 Idempotency-Key 를 보내고, wallet 환불 id 를 data 에 남긴다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ intentId: 'i1', refunds: [ok('wr1', 3000)] });

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
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [ok('wr2', 1000)] });
    await svc.refundPayment({
      data: { intentId: 'i1', externalRefund: { walletRefundId: 'wr7', amount: 5000 } },
      amount: 1000,
      context: { idempotency_key: 'ref_m3' },
    } as any);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('idempotency_key 가 없으면 지금처럼 키를 만들게 둔다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ refunds: [ok('wr3', 1000)] });
    await svc.refundPayment({ data: { intentId: 'i1' }, amount: 1000 } as any);
    expect((spy.mock.calls[0][1] as any).headers).toBeUndefined();
  });

  /**
   * wallet 은 PG 가 거절한 환불도 FAILED 행으로 200 에 담아 돌려준다(RefundsService.create 가 예외를 삼킨다).
   * 200 만 보고 성공으로 치면 Medusa 는 환불·크레딧 라인을 기록하고 부분취소는 refunded 가 되는데 돈은 안 나갔다.
   */
  describe('wallet 이 돌려준 환불 행 판정', () => {
    const refund = (svc: AlmondPaymentProviderService, amount = 3000) =>
      svc.refundPayment({ data: { intentId: 'i1' }, amount, context: { idempotency_key: 'ref_m9' } } as any);

    it('FAILED 행이 있으면 사유를 담아 던진다', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({
        intentId: 'i1',
        refunds: [{ id: 'wr1', amount: 3000, status: 'FAILED', reasonCode: 'MEDUSA_REFUND', reasonMessage: '카드사 거절' }],
      });
      await expect(refund(svc)).rejects.toThrow(/FAILED.*MEDUSA_REFUND.*카드사 거절/);
    });

    it('돌려받은 성공·대기 합이 요청보다 적으면 던진다', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ intentId: 'i1', refunds: [ok('wr1', 2000)] });
      await expect(refund(svc)).rejects.toThrow(/2000.*3000|3000.*2000/);
    });

    it('환불 행이 하나도 없으면 던진다', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ intentId: 'i1', refunds: [] });
      await expect(refund(svc)).rejects.toThrow(/wallet 환불/);
    });

    it('PENDING(무통장 송금 대기)은 성공으로 센다 — wallet 이 송금을 이어서 추적한다', async () => {
      const svc = makeService();
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ intentId: 'i1', refunds: [ok('wr1', 1000), ok('wr2', 2000, 'PENDING')] });
      const out = await refund(svc);
      expect(out.data).toEqual({ intentId: 'i1', walletRefundIds: ['wr1', 'wr2'] });
    });

    it('일부 결제분은 성공하고 하나가 실패하면 던지고, 성공한 wallet 환불 id 를 error 로그에 남긴다', async () => {
      const logger = makeLogger();
      const svc = makeService(logger);
      jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({
        intentId: 'i1',
        refunds: [ok('wr1', 1000), { id: 'wr2', amount: 2000, status: 'FAILED', reasonCode: 'MEDUSA_REFUND', reasonMessage: 'PG 오류' }],
      });
      await expect(refund(svc)).rejects.toThrow(/PG 오류/);
      expect(logger.error).toHaveBeenCalledTimes(1);
      const line = logger.error.mock.calls[0][0] as string;
      expect(line).toContain('i1');
      expect(line).toContain('wr1');
      expect(line).toContain('1000');
      expect(line).not.toContain('wr2');
    });
  });
});
