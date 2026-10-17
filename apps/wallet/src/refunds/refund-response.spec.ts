import type { Refund } from '../types';
import { toRefundListItem, toRefundResponse } from './refund-response';

const row = (overrides: Partial<Refund> = {}): Refund => ({
  id: 'rf-1',
  chargeId: 'ch-1',
  intentId: 'in-1',
  amount: 5000,
  currency: 'KRW',
  status: 'SUCCEEDED',
  reasonCode: 'MEDUSA_REFUND',
  reasonMessage: null,
  providerRefundId: 'pk-1',
  execution: 'AUTO',
  kind: null,
  failureCode: null,
  failureRetryable: null,
  createdAt: new Date('2026-10-11T00:00:00Z'),
  updatedAt: new Date('2026-10-11T00:00:00Z'),
  ...overrides,
});

describe('toRefundResponse', () => {
  it('성공 행: 실패 칸은 null, execution 은 그대로, manualConfirmable 기본 false', () => {
    expect(toRefundResponse(row())).toEqual({
      id: 'rf-1',
      chargeId: 'ch-1',
      intentId: 'in-1',
      status: 'SUCCEEDED',
      amount: 5000,
      currency: 'KRW',
      reasonCode: 'MEDUSA_REFUND',
      reasonMessage: null,
      createdAt: new Date('2026-10-11T00:00:00Z'),
      manualConfirmable: false,
      execution: 'AUTO',
      kind: null,
      failureCode: null,
      retryable: null,
    });
  });

  it('kind 를 그대로 싣는다', () => {
    expect(toRefundResponse(row({ kind: 'RETURN' })).kind).toBe('RETURN');
    expect(toRefundListItem(row({ kind: 'PAYMENT_ERROR' })).kind).toBe('PAYMENT_ERROR');
    expect(toRefundListItem(row()).kind).toBeNull();
  });

  it('분류된 FAILED 행은 failureCode 와 retryable 을 싣는다', () => {
    const res = toRefundResponse(
      row({
        status: 'FAILED',
        reasonMessage: '이미 취소된 결제 입니다.',
        failureCode: 'ALREADY_CANCELED_PAYMENT',
        failureRetryable: false,
      }),
    );
    expect(res).toMatchObject({ status: 'FAILED', failureCode: 'ALREADY_CANCELED_PAYMENT', retryable: false });
  });

  it('분류 전 옛 FAILED 행은 failureCode·retryable 이 null 그대로 — 지어내지 않는다', () => {
    const res = toRefundResponse(row({ status: 'FAILED', failureCode: null, failureRetryable: null }));
    expect(res.failureCode).toBeNull();
    expect(res.retryable).toBeNull();
  });

  it('manualConfirmable 은 호출자가 정한다', () => {
    expect(toRefundResponse(row({ status: 'PENDING', execution: 'MANUAL' }), true).manualConfirmable).toBe(true);
  });
});

describe('toRefundListItem', () => {
  it('스펙 §6.5 의 일곱 칸에 kind 를 더해 낸다', () => {
    expect(toRefundListItem(row({ status: 'PENDING', execution: 'MANUAL' }))).toEqual({
      id: 'rf-1',
      chargeId: 'ch-1',
      status: 'PENDING',
      amount: 5000,
      reasonCode: 'MEDUSA_REFUND',
      execution: 'MANUAL',
      kind: null,
      createdAt: new Date('2026-10-11T00:00:00Z'),
    });
  });
});
