import { of } from 'rxjs';
import { PaymentClientService } from '../payment-client.service';

/**
 * 환불 가능 조회는 화면 렌더링 경로(마이페이지 진입)에 있다.
 * wallet 을 매번 때리지 않고, 느려질 때 화면을 붙잡지 않는 것이 이 스펙의 관심사다.
 */
describe('PaymentClientService.getRefundability', () => {
  const response = {
    data: {
      intentId: 'intent_1',
      refundableAmount: 4990,
      alreadyRefundedAmount: 0,
      remainingRefundableAmount: 4990,
      autoRefundSupported: true,
      requiresReceiveAccount: false,
      methodTypes: ['TOSS'],
    },
  };

  function createService() {
    const httpService = { get: jest.fn().mockReturnValue(of(response)) };
    const configService = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'WALLET_API_URL' ? 'http://wallet' : key === 'WALLET_API_KEY' ? 'test-key' : fallback,
      ),
    };
    const service = new PaymentClientService(httpService as never, configService as never);
    return { service, httpService };
  }

  it('짧은 간격의 반복 조회는 wallet 을 한 번만 호출한다', async () => {
    const { service, httpService } = createService();

    await service.getRefundability('intent_1');
    await service.getRefundability('intent_1');

    expect(httpService.get).toHaveBeenCalledTimes(1);
  });

  it('다른 결제는 캐시를 공유하지 않는다', async () => {
    const { service, httpService } = createService();

    await service.getRefundability('intent_1');
    await service.getRefundability('intent_2');

    expect(httpService.get).toHaveBeenCalledTimes(2);
  });

  it('타임아웃을 걸어 wallet 지연이 화면을 붙잡지 않게 한다', async () => {
    const { service, httpService } = createService();

    await service.getRefundability('intent_1');

    const [, options] = httpService.get.mock.calls[0];
    expect(options.timeout).toBeGreaterThan(0);
  });
});
