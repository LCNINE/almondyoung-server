import { PaymentService } from '../payment.service';

describe('PaymentService - 단순 단위 테스트', () => {
  let service: PaymentService;

  beforeEach(() => {
    // Mock 의존성 없이 간단한 테스트
    service = new PaymentService(null as any, null as any);
  });

  describe('private 메서드 테스트', () => {
    it('getGatewayName - 결제수단 타입별 게이트웨이 이름 반환', () => {
      expect((service as any).getGatewayName('CARD')).toBe('hms_card');
      expect((service as any).getGatewayName('BNPL')).toBe('hms_bnpl');
      expect((service as any).getGatewayName('EASY_PAY')).toBe('toss');
      expect((service as any).getGatewayName('REWARD_POINT')).toBe(
        'internal_point',
      );
      expect((service as any).getGatewayName('UNKNOWN')).toBe('unknown');
    });

    it('callPaymentAdapter - Mock 어댑터 응답 확인', async () => {
      const cardResult = await (service as any).callPaymentAdapter('CARD', {
        paymentMethodId: 'pm_123',
        amount: 50000,
        currency: 'KRW',
        metadata: {},
      });

      expect(cardResult.status).toBe('CAPTURED');
      expect(cardResult.transactionId).toMatch(/^card_/);
      expect(cardResult.approvalNumber).toBe('APPR123456');

      const bnplResult = await (service as any).callPaymentAdapter('BNPL', {
        paymentMethodId: 'pm_123',
        amount: 50000,
        currency: 'KRW',
        metadata: {},
      });

      expect(bnplResult.status).toBe('AUTHORIZED'); // BNPL은 승인만
      expect(bnplResult.transactionId).toMatch(/^bnpl_/);
    });

    it('지원하지 않는 결제수단 타입 에러', async () => {
      await expect(
        (service as any).callPaymentAdapter('UNSUPPORTED', {
          paymentMethodId: 'pm_123',
          amount: 50000,
          currency: 'KRW',
          metadata: {},
        }),
      ).rejects.toThrow('지원하지 않는 결제수단 타입: UNSUPPORTED');
    });
  });
});
