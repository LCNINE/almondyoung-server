import { RefundService } from '../refund.service';

describe('RefundService - 단순 단위 테스트', () => {
  let service: RefundService;

  beforeEach(() => {
    // Mock 의존성 없이 간단한 테스트
    service = new RefundService(null as any);
  });

  describe('private 메서드 테스트', () => {
    it('extractPgTransactionId - eventContext에서 PG 트랜잭션 ID 추출', () => {
      // JSON 문자열 형태
      const jsonString = JSON.stringify({
        pg: { transactionId: 'tx_123' },
        business: { paymentPurpose: 'PURCHASE' },
      });
      expect((service as any).extractPgTransactionId(jsonString)).toBe(
        'tx_123',
      );

      // 객체 형태
      const objectForm = {
        pg: { transactionId: 'tx_456' },
        business: { paymentPurpose: 'PURCHASE' },
      };
      expect((service as any).extractPgTransactionId(objectForm)).toBe(
        'tx_456',
      );

      // 잘못된 형식
      expect((service as any).extractPgTransactionId('invalid json')).toBe(
        'unknown',
      );

      // PG 정보 없음
      const noPgInfo = JSON.stringify({
        business: { paymentPurpose: 'PURCHASE' },
      });
      expect((service as any).extractPgTransactionId(noPgInfo)).toBe('unknown');
    });

    it('callRefundAdapter - Mock 환불 어댑터 응답 확인', async () => {
      const cardRefund = await (service as any).callRefundAdapter('CARD', {
        pgTransactionId: 'tx_123',
        amount: 50000,
        reason: '고객 요청',
      });

      expect(cardRefund.success).toBe(true);
      expect(cardRefund.pgTransactionId).toMatch(/^refund_card_/);

      const bnplRefund = await (service as any).callRefundAdapter('BNPL', {
        pgTransactionId: 'tx_123',
        amount: 50000,
        reason: '고객 요청',
      });

      expect(bnplRefund.success).toBe(true);
      expect(bnplRefund.pgTransactionId).toMatch(/^refund_bnpl_/);

      const pointRefund = await (service as any).callRefundAdapter(
        'REWARD_POINT',
        {
          pgTransactionId: 'tx_123',
          amount: 50000,
          reason: '고객 요청',
        },
      );

      expect(pointRefund.success).toBe(true);
      expect(pointRefund.pgTransactionId).toMatch(/^refund_point_/);
    });

    it('지원하지 않는 결제수단 타입 환불 실패', async () => {
      const result = await (service as any).callRefundAdapter('UNSUPPORTED', {
        pgTransactionId: 'tx_123',
        amount: 50000,
        reason: '고객 요청',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('지원하지 않는 결제수단 타입');
    });

    it('getGatewayName - 결제수단 타입별 게이트웨이 이름 반환', () => {
      expect((service as any).getGatewayName('CARD')).toBe('hms_card');
      expect((service as any).getGatewayName('BNPL')).toBe('hms_bnpl');
      expect((service as any).getGatewayName('EASY_PAY')).toBe('toss');
      expect((service as any).getGatewayName('REWARD_POINT')).toBe(
        'internal_point',
      );
      expect((service as any).getGatewayName('UNKNOWN')).toBe('unknown');
    });
  });
});
