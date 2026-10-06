import { BigNumber } from '@medusajs/framework/utils';
import { AlmondPaymentProviderService } from '../service';

/**
 * Medusa 의 PaymentModuleService 는 환불 금액을 `refund.raw_amount`({ value, precision }) 로 넘긴다.
 * `Number(rawAmount)` 는 NaN 이라 wallet 에 `amount: null` 이 나갔다.
 */
describe('almond-payment refundPayment 금액 변환', () => {
  const build = () => {
    const svc = new AlmondPaymentProviderService({}, { walletBaseUrl: 'http://wallet.test', walletApiKey: 'k' } as any);
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({});
    return { svc, spy };
  };
  const refund = (svc: AlmondPaymentProviderService, amount: any) =>
    svc.refundPayment({ data: { intentId: 'int_1' }, amount } as any);
  const sentAmount = (spy: jest.SpyInstance) => JSON.parse(spy.mock.calls[0][1].body).amount;

  it.each([
    ['number', 33000],
    ['string', '33000'],
    ['raw amount 객체', { value: '33000', precision: 20 }],
    ['BigNumber 인스턴스', new BigNumber(33000)],
  ])('%s 를 33000 으로 보낸다', async (_n, amount) => {
    const { svc, spy } = build();
    await refund(svc, amount);
    expect(spy.mock.calls[0][0]).toBe('/v1/payment-intents/int_1/refund');
    expect(sentAmount(spy)).toBe(33000);
  });

  it.each([
    ['NaN', NaN],
    ['0', 0],
    ['음수', -1],
    ['소수', 10.5],
    ['쓰레기 객체', { foo: 1 }],
  ])('%s 는 wallet 을 부르지 않고 던진다', async (_n, amount) => {
    const { svc, spy } = build();
    await expect(refund(svc, amount)).rejects.toThrow(/환불 금액/);
    expect(spy).not.toHaveBeenCalled();
  });
});
