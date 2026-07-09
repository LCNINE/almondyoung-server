import { InvoiceOutcomeService } from './invoice-outcome.service';

// ADR-0027 §3-1 핵심 분기: 재시도 여지(PAST_DUE) vs 소진(UNCOLLECTIBLE), 터미널 멱등 no-op,
// mandate 거절 이벤트 발행.

const baseInvoice = {
  id: 'inv-1',
  subscriberType: 'MEMBERSHIP',
  subscriberRef: 'contract-1',
  billingMethodId: 'method-1',
  amountDue: 9900,
  currency: 'KRW',
  periodStart: '2026-07-08',
  periodEnd: '2026-08-07',
  dueDate: '2026-07-08',
  status: 'ATTEMPTING',
  attemptCount: 0,
  maxAttempts: 3,
  retryIntervalHours: 72,
  idempotencyKey: 'membership:invoice:contract-1:2026-07-08',
  metadata: {},
};

function makeService(lockedInvoice: Record<string, unknown> | null) {
  const inserted: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const tx = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    for: jest.fn().mockResolvedValue(lockedInvoice ? [lockedInvoice] : []),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockImplementation((v: Record<string, unknown>) => {
      updates.push(v);
      return tx;
    }),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockImplementation((v: Record<string, unknown>) => {
      inserted.push(v);
      return Promise.resolve();
    }),
  };
  const db = {
    transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };
  const service = new InvoiceOutcomeService({ db } as never);
  return { service, tx, inserted, updates };
}

describe('InvoiceOutcomeService.registerAttemptFailure', () => {
  it('재시도 여지가 있으면 PAST_DUE + attempt+1 + invoice.payment_failed 발행', async () => {
    const { service, updates, inserted } = makeService({ ...baseInvoice, attemptCount: 0 });

    await service.registerAttemptFailure('inv-1', 'intent-1', 'Q999', '잔액부족');

    const update = updates[0];
    expect(update.status).toBe('PAST_DUE');
    expect(update.attemptCount).toBe(1);
    expect(update.nextAttemptAt).toBeInstanceOf(Date);
    expect(inserted[0].eventType).toBe('invoice.payment_failed');
    const payload = inserted[0].payload as Record<string, unknown>;
    expect(payload.attemptCount).toBe(1);
    expect(payload.subscriberRef).toBe('contract-1');
  });

  it('마지막 시도 실패면 UNCOLLECTIBLE(터미널) + invoice.uncollectible 발행', async () => {
    const { service, updates, inserted } = makeService({ ...baseInvoice, attemptCount: 2, maxAttempts: 3 });

    await service.registerAttemptFailure('inv-1', 'intent-3', 'Q999', '잔액부족');

    const update = updates[0];
    expect(update.status).toBe('UNCOLLECTIBLE');
    expect(update.attemptCount).toBe(3);
    expect(update.finalizedAt).toBeInstanceOf(Date);
    expect(update.nextAttemptAt).toBeNull();
    expect(inserted[0].eventType).toBe('invoice.uncollectible');
  });

  it('같은 intent 의 실패가 두 경로로 도착해도 attempt 는 한 번만 집계', async () => {
    const { service, updates } = makeService({
      ...baseInvoice,
      status: 'PAST_DUE',
      attemptCount: 1,
      metadata: { lastFailedIntentId: 'intent-1' },
    });

    await service.registerAttemptFailure('inv-1', 'intent-1', 'Q999', '잔액부족');

    expect(updates).toHaveLength(0);
  });

  it('터미널 인보이스에는 no-op (재전달 멱등)', async () => {
    const { service, updates, inserted } = makeService(null);

    await service.registerAttemptFailure('inv-1', 'intent-1', 'Q999', '잔액부족');

    expect(updates).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});

describe('InvoiceOutcomeService.markPaid', () => {
  it('PAID(터미널) 전이 + invoice.paid 발행', async () => {
    const { service, updates, inserted } = makeService({ ...baseInvoice });

    await service.markPaid('inv-1', 'intent-1');

    expect(updates[0].status).toBe('PAID');
    expect(updates[0].nextAttemptAt).toBeNull();
    expect(inserted[0].eventType).toBe('invoice.paid');
    const payload = inserted[0].payload as Record<string, unknown>;
    expect(payload.intentId).toBe('intent-1');
    expect(payload.periodEnd).toBe('2026-08-07');
  });

  it('이미 터미널이면 no-op', async () => {
    const { service, updates } = makeService(null);
    await service.markPaid('inv-1', 'intent-1');
    expect(updates).toHaveLength(0);
  });
});

describe('InvoiceOutcomeService.rejectMandate', () => {
  it('MANDATE_REJECTED(터미널) 전이 + mandate.rejected 발행(선적용 회수 트리거)', async () => {
    const { service, updates, inserted } = makeService({ ...baseInvoice, status: 'MANDATE_PENDING' });

    await service.rejectMandate('inv-1', 'Q201', '생년월일/사업자번호 불일치');

    expect(updates[0].status).toBe('MANDATE_REJECTED');
    expect(inserted[0].eventType).toBe('mandate.rejected');
    const payload = inserted[0].payload as Record<string, unknown>;
    expect(payload.reasonCode).toBe('Q201');
    expect(payload.billingMethodId).toBe('method-1');
    expect(payload.subscriberRef).toBe('contract-1');
  });
});
