import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import { Invoice } from '../types';
import {
  buildInvoicePaidPayload,
  buildInvoicePaymentFailedPayload,
  buildInvoiceUncollectiblePayload,
  buildInvoiceVoidedPayload,
  buildMandateRejectedPayload,
} from './invoice-event.builder';

// 발행 경로는 페이로드를 스키마로 파싱한 «결과»를 보낸다. 스키마에 없는 필드는 조용히 지워지므로,
// 빌더가 싣는 필드는 전부 스키마를 통과해 그대로 남아야 한다.
describe('인보이스 이벤트 빌더 ↔ 발행 스키마', () => {
  const invoice: Invoice = {
    id: 'inv-1',
    subscriberType: 'MEMBERSHIP',
    subscriberRef: 'contract-1',
    billingMethodId: 'bm-1',
    amountDue: 9900,
    currency: 'KRW',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    dueDate: '2026-09-01',
    status: 'PAST_DUE',
    attemptCount: 1,
    maxAttempts: 3,
    retryIntervalHours: 48,
    nextAttemptAt: new Date('2026-09-03T00:00:00Z'),
    finalizedAt: null,
    idempotencyKey: 'membership:invoice:contract-1:2026-09-01',
    metadata: {},
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  };

  const cases: Array<[keyof typeof PAYMENT_STREAM.events, Record<string, unknown>]> = [
    ['invoice.paid', { ...buildInvoicePaidPayload(invoice, 'pi-1') }],
    [
      'invoice.payment_failed',
      {
        ...buildInvoicePaymentFailedPayload(invoice, {
          intentId: 'pi-1',
          attemptCount: 1,
          nextAttemptAt: new Date('2026-09-03T00:00:00Z'),
          errorCode: 'E1',
          errorMessage: '잔액 부족',
        }),
      },
    ],
    [
      'invoice.uncollectible',
      { ...buildInvoiceUncollectiblePayload(invoice, { intentId: 'pi-1', errorCode: 'E1', errorMessage: null }) },
    ],
    ['mandate.rejected', { ...buildMandateRejectedPayload(invoice, { reasonCode: 'R1', reason: null }) }],
    ['invoice.voided', { ...buildInvoiceVoidedPayload(invoice, { reason: null, canceledIntentId: null }) }],
  ];

  it.each(cases)('%s 페이로드는 스키마 파싱 뒤에도 모든 필드가 남는다', (eventType, payload) => {
    const schema = PAYMENT_STREAM.events[eventType].schema;
    if (!schema) throw new Error(`${eventType} 에 발행 스키마가 없다`);
    const parsed = schema.safeParse(payload);

    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual(payload);
  });
});
