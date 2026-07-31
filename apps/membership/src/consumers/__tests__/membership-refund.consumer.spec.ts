import { MembershipRefundConsumer } from '../membership-refund.consumer';

/**
 * 결제관리에서 건 환불 이벤트가 멤버십 계약에 어떻게 반영되는지.
 *
 * 부분 환불(소액 보상)은 이제 구독을 취소하지 않으므로 **계약이 살아남는다**. 그 이벤트로
 * refundCompleted 를 켜면 나중에 진짜 해지 환불이 수동 송금으로 남았을 때 관리자가 그 건을
 * 닫을 수 없게 된다(markManualRefundCompleted 가 '이미 환불 완료' 로 영구히 409).
 */
describe('MembershipRefundConsumer', () => {
  const subscriptionService = { voidByPaymentIntent: jest.fn() };
  const contractReader = { findByPaymentIntentId: jest.fn() };
  const refundEventHandler = { handleRefundCompleted: jest.fn() };

  const consumer = new MembershipRefundConsumer(
    subscriptionService as never,
    contractReader as never,
    refundEventHandler as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('멤버십이 요청한 환불이 완료되면 계약에 기록한다', async () => {
    contractReader.findByPaymentIntentId.mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      refundRequested: true,
      refundCompleted: false,
      eligibleRefundAmount: 4990,
    });

    await consumer.onRefundSucceeded({ intentId: 'intent_1', amount: 4990, refundId: 'r1' });

    expect(refundEventHandler.handleRefundCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ contractId: 'c1', amount: 4990 }),
    );
  });

  it('멤버십이 요청하지 않은 환불(결제관리 소액 보상)은 환불 완료로 찍지 않는다', async () => {
    contractReader.findByPaymentIntentId.mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      refundRequested: false,
      refundCompleted: false,
      eligibleRefundAmount: null,
    });

    await consumer.onRefundSucceeded({ intentId: 'intent_1', amount: 1000, refundId: 'r1' });

    // 자격 회수 판단은 voidByPaymentIntent 가 (전액인지 보고) 따로 한다.
    expect(subscriptionService.voidByPaymentIntent).toHaveBeenCalledWith('intent_1', '결제 환불', 1000);
    expect(refundEventHandler.handleRefundCompleted).not.toHaveBeenCalled();
  });

  it('이미 환불 완료된 계약에는 다시 기록하지 않는다', async () => {
    contractReader.findByPaymentIntentId.mockResolvedValue({
      id: 'c1',
      userId: 'u1',
      refundRequested: true,
      refundCompleted: true,
      eligibleRefundAmount: 4990,
    });

    await consumer.onRefundSucceeded({ intentId: 'intent_1', amount: 4990 });

    expect(refundEventHandler.handleRefundCompleted).not.toHaveBeenCalled();
  });
});
