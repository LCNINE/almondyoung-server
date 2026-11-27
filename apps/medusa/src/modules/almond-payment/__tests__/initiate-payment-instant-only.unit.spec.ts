import { AlmondPaymentProviderService } from '../service';

const makeService = () =>
  new AlmondPaymentProviderService({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }, {
    walletBaseUrl: 'http://wallet.test',
    walletApiKey: 'k',
  } as any);

const bodyOf = (spy: jest.SpyInstance) => JSON.parse(spy.mock.calls[0][1].body);

describe('initiatePayment instantOnly', () => {
  it('함께 배송 결제면 intent metadata 에 instantOnly 를 싣는다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ id: 'pi_1' });

    await svc.initiatePayment({ amount: 6500, currency_code: 'krw', data: { instantOnly: true } } as any);

    expect(bodyOf(spy).metadata.instantOnly).toBe(true);
  });

  it('표식이 없으면 싣지 않는다', async () => {
    const svc = makeService();
    const spy = jest.spyOn(svc as any, 'walletFetch').mockResolvedValue({ id: 'pi_1' });

    await svc.initiatePayment({ amount: 6500, currency_code: 'krw', data: { instantOnly: 'yes' } } as any);

    expect(bodyOf(spy).metadata?.instantOnly).toBeUndefined();
  });
});
