import {
  InvoicePaidPayload,
  InvoicePaymentFailedPayload,
  InvoiceUncollectiblePayload,
  InvoiceVoidedPayload,
  MandateRejectedPayload,
} from '@packages/event-contracts/streams/payment.stream';
import { Logger } from '@nestjs/common';
import { InvoiceResultConsumer } from '../invoice-result.consumer';

// 계약(payment.stream)이 요구하는 필드를 전부 채운 기본 payload.
// 이 테스트가 보는 건 "라우팅"이지 payload 내용이 아니므로, 각 테스트는
// 자기가 단언하는 필드만 override 한다.
const OCCURRED_AT = '2026-08-07T00:00:00.000Z';

function paid(overrides: Partial<InvoicePaidPayload> = {}): InvoicePaidPayload {
  return {
    invoiceId: 'inv-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    periodStart: '2026-07-07',
    periodEnd: '2026-08-07',
    amount: 9900,
    currency: 'KRW',
    intentId: 'intent-1',
    paidAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function paymentFailed(overrides: Partial<InvoicePaymentFailedPayload> = {}): InvoicePaymentFailedPayload {
  return {
    invoiceId: 'inv-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: OCCURRED_AT,
    errorCode: 'Q999',
    errorMessage: '잔액부족',
    intentId: 'intent-2',
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function mandateRejected(overrides: Partial<MandateRejectedPayload> = {}): MandateRejectedPayload {
  return {
    invoiceId: 'inv-1',
    billingMethodId: 'bm-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    reasonCode: 'Q201',
    reason: null,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function uncollectible(overrides: Partial<InvoiceUncollectiblePayload> = {}): InvoiceUncollectiblePayload {
  return {
    invoiceId: 'inv-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    periodStart: '2026-07-07',
    periodEnd: '2026-08-07',
    errorCode: 'Q999',
    errorMessage: null,
    intentId: null,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

function voided(overrides: Partial<InvoiceVoidedPayload> = {}): InvoiceVoidedPayload {
  return {
    invoiceId: 'inv-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    periodStart: '2026-07-07',
    periodEnd: '2026-08-07',
    reason: 'EXPLICIT_INTENT_CANCEL',
    intentId: null,
    occurredAt: OCCURRED_AT,
    ...overrides,
  };
}

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
    await consumer.onInvoicePaid(paid());
    expect(handler.handlePaid).toHaveBeenCalledWith('contract-1', 'inv-1', '2026-08-07', 9900, 'intent-1');
  });

  it('invoice.payment_failed → handlePaymentFailed (자격 유지, 연체 표시)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoicePaymentFailed(paymentFailed());
    expect(handler.handlePaymentFailed).toHaveBeenCalledWith('contract-1', 'inv-1', 'intent-2', 1, 'Q999', '잔액부족');
  });

  it('mandate.rejected → handleMandateRejected (선적용 자격 회수)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onMandateRejected(mandateRejected());
    expect(handler.handleMandateRejected).toHaveBeenCalledWith('contract-1', 'inv-1', 'Q201');
  });

  it('invoice.uncollectible → handleUncollectible (자격 종료)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoiceUncollectible(uncollectible());
    expect(handler.handleUncollectible).toHaveBeenCalledWith('contract-1', 'inv-1', 'Q999');
  });

  it('invoice.voided → handleVoided (명시 취소 — 선적용 자격 회수)', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoiceVoided(voided());
    expect(handler.handleVoided).toHaveBeenCalledWith('contract-1', 'inv-1', 'EXPLICIT_INTENT_CANCEL');
  });

  it('subscriberType 이 MEMBERSHIP 이 아니거나 subscriberRef/periodEnd 가 없으면 무시', async () => {
    const { consumer, handler } = makeConsumer();
    await consumer.onInvoicePaid(paid({ subscriberType: 'ORDER' }));
    // subscriberRef / periodEnd 누락은 계약상 불가능한 입력이다. 그래도 런타임
    // 가드가 사는지 보려면 계약을 일부러 위반해야 해서 undefined 를 넣는다.
    await consumer.onInvoicePaid(paid({ periodEnd: undefined as unknown as string }));
    await consumer.onMandateRejected(mandateRejected({ subscriberRef: undefined as unknown as string }));
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
