import { Logger } from '@nestjs/common';
import { InvoiceResultConsumer } from '../invoice-result.consumer';

function makeConsumer() {
  const handler = {
    handlePaid: jest.fn().mockResolvedValue(undefined),
    handlePaymentFailed: jest.fn().mockResolvedValue(undefined),
    handleUncollectible: jest.fn().mockResolvedValue(undefined),
    handleMandateRejected: jest.fn().mockResolvedValue(undefined),
    handleVoided: jest.fn().mockResolvedValue(undefined),
  };
  const consumer = new InvoiceResultConsumer(handler as never);
  return { consumer, handler };
}

describe('InvoiceResultConsumer 라우팅', () => {
  it('invoice.paid → handlePaid (자격 연장 + 다음 주기 예약)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoicePaid({
      invoiceId: 'inv-1',
      subscriberType: 'MEMBERSHIP',
      subscriberRef: 'contract-1',
      periodEnd: '2026-08-07',
      amount: 9900,
      intentId: 'intent-1',
    });
    expect(handler.handlePaid).toHaveBeenCalledWith('contract-1', 'inv-1', '2026-08-07', 9900, 'intent-1');
  });

  it('invoice.payment_failed → handlePaymentFailed (자격 유지, 연체 표시)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoicePaymentFailed({
      invoiceId: 'inv-1',
      subscriberType: 'MEMBERSHIP',
      subscriberRef: 'contract-1',
      intentId: 'intent-2',
      attemptCount: 1,
      errorCode: 'Q999',
      errorMessage: '잔액부족',
    });
    expect(handler.handlePaymentFailed).toHaveBeenCalledWith('contract-1', 'inv-1', 'intent-2', 1, 'Q999', '잔액부족');
  });

  it('mandate.rejected → handleMandateRejected (선적용 자격 회수)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onMandateRejected({
      invoiceId: 'inv-1',
      subscriberType: 'MEMBERSHIP',
      subscriberRef: 'contract-1',
      reasonCode: 'Q201',
    });
    expect(handler.handleMandateRejected).toHaveBeenCalledWith('contract-1', 'inv-1', 'Q201');
  });

  it('invoice.uncollectible → handleUncollectible (자격 종료)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoiceUncollectible({
      invoiceId: 'inv-1',
      subscriberType: 'MEMBERSHIP',
      subscriberRef: 'contract-1',
      errorCode: 'Q999',
    });
    expect(handler.handleUncollectible).toHaveBeenCalledWith('contract-1', 'inv-1', 'Q999');
  });

  it('invoice.voided → handleVoided (명시 취소 — 선적용 자격 회수)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoiceVoided({
      invoiceId: 'inv-1',
      subscriberType: 'MEMBERSHIP',
      subscriberRef: 'contract-1',
      reason: 'EXPLICIT_INTENT_CANCEL',
    });
    expect(handler.handleVoided).toHaveBeenCalledWith('contract-1', 'inv-1', 'EXPLICIT_INTENT_CANCEL');
  });

  it('subscriberType 이 MEMBERSHIP 이 아니거나 subscriberRef/periodEnd 가 없으면 무시', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoicePaid({ invoiceId: 'i', subscriberType: 'ORDER', subscriberRef: 'x', periodEnd: 'd' });
    await consumer.onInvoicePaid({ invoiceId: 'i', subscriberType: 'MEMBERSHIP', subscriberRef: 'x' });
    await consumer.onMandateRejected({ invoiceId: 'i', subscriberType: 'MEMBERSHIP' });
    expect(handler.handlePaid).not.toHaveBeenCalled();
    expect(handler.handleMandateRejected).not.toHaveBeenCalled();
  });

  it('예상치 못한 subscriberType 은 조용히 버리지 않고 경고로 남긴다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoiceUncollectible({ invoiceId: 'i', subscriberType: 'PARTNER', subscriberRef: 'x' } as never);
    expect(handler.handleUncollectible).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('subscriberType=PARTNER'));
    warn.mockRestore();
  });
});
