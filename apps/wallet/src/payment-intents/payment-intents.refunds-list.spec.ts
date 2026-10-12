import { NotFoundException } from '@nestjs/common';
import type { Refund } from '../types';

// Mock wallet.module to prevent EventsModule.forApp requiring KAFKA_BROKERS in test environment
jest.mock('../wallet.module', () => ({
  AuthenticatedRequest: jest.fn(),
}));

import { PaymentIntentsController } from './payment-intents.controller';

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
    const intents = { findByIdOrThrow: jest.fn().mockResolvedValue({ id: 'in-1' }) };
    const refunds = {
      listByIntent: jest
        .fn()
        .mockResolvedValue([refund('rf-1', 'FAILED', 'AUTO'), refund('rf-2', 'PENDING', 'MANUAL')]),
    };
    const controller = new PaymentIntentsController(intents as never, refunds as never);

    const result = await controller.listRefunds('in-1');

    expect(refunds.listByIntent).toHaveBeenCalledWith('in-1');
    expect(result.map((r) => [r.id, r.status, r.execution])).toEqual([
      ['rf-1', 'FAILED', 'AUTO'],
      ['rf-2', 'PENDING', 'MANUAL'],
    ]);
  });

  it('없는 intent 는 404 그대로, 목록을 읽지 않는다', async () => {
    const notFound = new NotFoundException({ error: 'INTENT_NOT_FOUND', message: 'Payment intent not found: x' });
    const intents = { findByIdOrThrow: jest.fn().mockRejectedValue(notFound) };
    const refunds = { listByIntent: jest.fn() };
    const controller = new PaymentIntentsController(intents as never, refunds as never);

    await expect(controller.listRefunds('x')).rejects.toBe(notFound);
    expect(refunds.listByIntent).not.toHaveBeenCalled();
  });
});
