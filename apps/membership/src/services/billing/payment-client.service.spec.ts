import { of } from 'rxjs';
import { PaymentClientService } from './payment-client.service';

describe('PaymentClientService.refundByIntent', () => {
  function createService() {
    const httpService = {
      post: jest
        .fn()
        .mockReturnValue(of({ data: { intentId: 'i1', refunds: [{ id: 'r1', amount: 9900, status: 'SUCCEEDED' }] } })),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: string) =>
        key === 'WALLET_API_URL' ? 'http://wallet' : key === 'WALLET_API_KEY' ? 'test-key' : fallback,
      ),
    };
    const service = new PaymentClientService(httpService as never, configService as never);
    return { service, httpService };
  }

  it('환불 바디에 구독료 환불 종류를 싣고 사유 코드는 그대로 둔다', async () => {
    const { service, httpService } = createService();

    await service.refundByIntent('i1', 9900, 'NOT_USING');

    expect(httpService.post).toHaveBeenCalledWith(
      'http://wallet/v1/payment-intents/i1/refund',
      expect.objectContaining({ kind: 'SUBSCRIPTION_FEE', reasonCode: 'NOT_USING', allowMembershipRefund: true }),
      expect.anything(),
    );
  });
});
