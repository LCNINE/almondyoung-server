import type { Refund } from '../types';
import { toRefundListItem } from '../refunds/refund-response';

const refund = (id: string, status: Refund['status'], execution: Refund['execution']): Refund => ({
  id,
  chargeId: 'ch-1',
  intentId: 'in-1',
  amount: 1000,
  currency: 'KRW',
  status,
  reasonCode: null,
  reasonMessage: null,
  providerRefundId: null,
  execution,
  failureCode: null,
  failureRetryable: null,
  createdAt: new Date('2026-10-11T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
});

describe('GET /v1/payment-intents/:id/refunds', () => {
  it('intent 의 환불을 서비스 순서대로 목록 칸으로 낸다', async () => {
    const refunds = [refund('rf-1', 'FAILED', 'AUTO'), refund('rf-2', 'PENDING', 'MANUAL')];
    const result = refunds.map(toRefundListItem);

    expect(result.map((r) => [r.id, r.status, r.execution])).toEqual([
      ['rf-1', 'FAILED', 'AUTO'],
      ['rf-2', 'PENDING', 'MANUAL'],
    ]);
  });

  it('환불 목록은 일곱 칸만 낸다', () => {
    const r = refund('rf-1', 'PENDING', 'MANUAL');
    const result = toRefundListItem(r);

    expect(Object.keys(result).sort()).toEqual([
      'amount',
      'chargeId',
      'createdAt',
      'execution',
      'id',
      'reasonCode',
      'status',
    ]);
  });
});
