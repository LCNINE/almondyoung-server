import { ConflictException } from '@nestjs/common';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { paymentIntents } from '../schema';
import type { Refund } from '../types';
import { RefundsService, AMBIGUOUS_RESEND_WINDOW_MS } from './refunds.service';

const account = { bank: '06', accountNumber: '1234567890', holderName: '테스트' };

function fixture(overrides: Partial<Refund> = {}, methodType = 'BANK_TRANSFER') {
  const row: Refund = {
    id: 'refund-1',
    chargeId: 'charge-1',
    intentId: 'intent-1',
    amount: 5000,
    currency: 'KRW',
    status: 'PENDING',
    execution: 'MANUAL',
    reasonCode: 'MEDUSA_REFUND',
    reasonMessage: null,
    providerRefundId: null,
    kind: 'ITEM_CANCEL',
    failureCode: null,
    failureRetryable: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  const forUpdate = jest.fn();
  const beforeNotify = jest.fn().mockResolvedValue(undefined);
  const provider = { refund: jest.fn().mockResolvedValue({ status: 'SUCCEEDED', providerRefundId: 'pg-1' }) };
  const writes: Partial<Refund>[] = [];
  const db = {
    execute: jest.fn().mockResolvedValue([]),
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (condition: SQL) => {
          const ambiguous = new PgDialect().sqlToQuery(condition).sql.includes('failure_code');
          const rows = () =>
            table === paymentIntents
              ? [{ userId: 'user-1', metadata: {} }]
              : ambiguous &&
                  !(
                    row.status === 'FAILED' &&
                    row.execution === 'AUTO' &&
                    row.failureCode === 'PROVIDER_EXCEPTION' &&
                    row.createdAt.getTime() > Date.now() - AMBIGUOUS_RESEND_WINDOW_MS
                  )
                ? []
                : [{ ...row }];
          const result = Promise.resolve(rows());

          return Object.assign(result, {
            limit: async () => {
              if (table === paymentIntents && fields && 'metadata' in fields) await beforeNotify();

              return rows();
            },
            for: (lock: string) => {
              forUpdate(lock);
              return { limit: () => Promise.resolve(rows()) };
            },
          });
        },
      }),
    }),
    update: () => ({
      set: (values: Partial<Refund>) => ({
        where: () => {
          writes.push(values);
          Object.assign(row, values);

          return Object.assign(Promise.resolve(), { returning: () => Promise.resolve([{ ...row }]) });
        },
      }),
    }),
  };
  let tail = Promise.resolve();
  const transaction = <T>(run: (tx: typeof db) => Promise<T>) => {
    const next = tail.then(() => run(db));
    tail = next.then(
      () => undefined,
      () => undefined,
    );

    return next;
  };
  const transitions = {
    transitionRefund: jest.fn(async (_id: string, status: Refund['status']) => {
      row.status = status;
    }),
    transitionCharge: jest.fn(),
  };
  const receipts = { cancelForRefund: jest.fn() };
  const service = new RefundsService(
    { db: { ...db, transaction } } as never,
    {
      findById: jest.fn().mockResolvedValue({
        id: row.chargeId,
        intentId: row.intentId,
        paymentMethodId: 'pm-1',
        amount: 5000,
        currency: 'KRW',
      }),
    } as never,
    receipts as never,
    { findById: jest.fn().mockResolvedValue({ type: methodType, providerData: {} }) } as never,
    { getProviderOrThrow: () => provider } as never,
    transitions as never,
  );

  return { service, row, provider, transitions, writes, forUpdate, receipts, beforeNotify };
}

describe('executeBankRefund', () => {
  it('기존 행과 사유·금액·멱등키를 유지하고 계좌는 PG 에만 전달한다', async () => {
    const f = fixture();
    const result = await f.service.executeBankRefund(f.row.id, account);

    expect(result).toMatchObject({
      id: 'refund-1',
      status: 'SUCCEEDED',
      execution: 'AUTO',
      reasonCode: 'MEDUSA_REFUND',
    });
    expect(f.forUpdate).toHaveBeenCalledWith('update');
    expect(f.provider.refund).toHaveBeenCalledWith(
      expect.objectContaining({
        refundId: 'refund-1',
        amount: 5000,
        idempotencyKey: 'wallet:refund:refund-1',
        refundReceiveAccount: account,
      }),
    );
    expect(f.transitions.transitionRefund).toHaveBeenCalledWith(
      'refund-1',
      'SUCCEEDED',
      expect.objectContaining({
        outboxEvent: expect.objectContaining({
          eventType: 'gateway.refund.succeeded',
          payload: expect.objectContaining({ refundId: 'refund-1', reasonCode: 'MEDUSA_REFUND', amount: 5000 }),
        }),
      }),
      'PENDING',
      expect.anything(),
    );
    expect(JSON.stringify(f.writes)).not.toContain(account.accountNumber);
    expect(JSON.stringify(f.transitions.transitionRefund.mock.calls)).not.toContain(account.accountNumber);
    expect(f.receipts.cancelForRefund).toHaveBeenCalledWith('charge-1');
  });

  it('동시 두 번 클릭과 수동 완료는 실행 중인 행을 가져가지 못한다', async () => {
    const f = fixture();
    let release: (value: { status: string }) => void = () => undefined;
    f.provider.refund.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const first = f.service.executeBankRefund(f.row.id, account);
    const second = f.service.executeBankRefund(f.row.id, account);

    await expect(second).rejects.toBeInstanceOf(ConflictException);
    await expect(f.service.confirmManual(f.row.id)).rejects.toThrow();
    expect(f.provider.refund).toHaveBeenCalledTimes(1);
    release({ status: 'SUCCEEDED' });
    await first;
  });

  it('수동 완료의 사전 조회 뒤 계좌 환불이 선점해도 잠금 안에서 다시 거절한다', async () => {
    const f = fixture();
    let resume: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      reached = resolve;
    });
    f.beforeNotify.mockImplementationOnce(() => {
      reached();
      return paused;
    });
    const confirmation = f.service.confirmManual(f.row.id);
    await ready;
    await f.service.executeBankRefund(f.row.id, account);
    resume();

    await expect(confirmation).rejects.toBeInstanceOf(ConflictException);
    expect(f.transitions.transitionRefund).toHaveBeenCalledTimes(1);
  });

  it('수동 완료가 먼저 선점하면 계좌 송금은 거절한다', async () => {
    const f = fixture();
    await f.service.confirmManual(f.row.id);

    await expect(f.service.executeBankRefund(f.row.id, account)).rejects.toBeInstanceOf(ConflictException);
    expect(f.provider.refund).not.toHaveBeenCalled();
  });

  it('응답 유실은 같은 행·같은 키로 재전송하며 원문 오류를 저장하지 않는다', async () => {
    const f = fixture();
    f.provider.refund.mockRejectedValueOnce(new Error(account.accountNumber));

    await expect(f.service.executeBankRefund(f.row.id, account)).resolves.toMatchObject({
      status: 'FAILED',
      failureCode: 'PROVIDER_EXCEPTION',
    });
    expect(JSON.stringify(f.row)).not.toContain(account.accountNumber);
    await expect(f.service.executeBankRefund(f.row.id, account)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    expect(f.provider.refund.mock.calls.map(([arg]) => arg.idempotencyKey)).toEqual([
      'wallet:refund:refund-1',
      'wallet:refund:refund-1',
    ]);
  });

  it.each([
    { status: 'SUCCEEDED' as const },
    { execution: 'AUTO' as const },
    { status: 'FAILED' as const, execution: 'AUTO' as const, failureCode: 'INVALID_REFUND_ACCOUNT_INFO' },
    {
      status: 'FAILED' as const,
      execution: 'AUTO' as const,
      failureCode: 'PROVIDER_EXCEPTION',
      createdAt: new Date(0),
    },
  ])('대상이 아닌 환불은 PG 호출 없이 거절: %s', async (overrides) => {
    const f = fixture(overrides);

    await expect(f.service.executeBankRefund(f.row.id, account)).rejects.toBeInstanceOf(ConflictException);
    expect(f.provider.refund).not.toHaveBeenCalled();
  });

  it('카드 환불은 계좌로 보낼 수 없다', async () => {
    const f = fixture({}, 'TOSS');

    await expect(f.service.executeBankRefund(f.row.id, account)).rejects.toThrow('무통장');
    expect(f.provider.refund).not.toHaveBeenCalled();
  });

  it('PG 정보가 없는 옛 무통장은 수동 대기로 돌아간다', async () => {
    const f = fixture();
    f.provider.refund.mockResolvedValue({ status: 'PENDING', manualTransfer: true });

    await expect(f.service.executeBankRefund(f.row.id, account)).resolves.toMatchObject({
      status: 'PENDING',
      execution: 'MANUAL',
    });
    expect(f.transitions.transitionRefund).not.toHaveBeenCalled();
  });
});
