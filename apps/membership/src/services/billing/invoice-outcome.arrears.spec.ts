import { InvoiceOutcomeHandler } from './invoice-outcome.handler';

/**
 * 미수(외상) 원장이 «자격 회수와 같은 트랜잭션에서» 정확히 한 줄 생기는지 못 박는다.
 * 판정축은 부여축 — 자격을 들고 있었으면 적고, 아예 없었거나 그 주기를 못 덮었으면 안 적는다.
 */
function makeHandler(opts: {
  contract?: Record<string, unknown> | null;
  heldEntitlement?: { endsAt: string } | null;
  plan?: { price: number; currency: string } | null;
}) {
  const contract = opts.contract ?? {
    userId: 'u1',
    status: 'ACTIVE',
    autoRenewal: true,
    billingPath: 'INVOICE',
    nextBillingDate: '2026-07-07',
    recurringCancelledAt: null,
  };

  // limit() 이 도착하는 순서대로 돌려준다: ①계약 ②보유 자격 ③플랜(폴백일 때만)
  const selectQueue: unknown[][] = [
    contract ? [contract] : [],
    opts.heldEntitlement ? [opts.heldEntitlement] : [],
    opts.plan ? [opts.plan] : [],
  ];

  const tx = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockImplementation(() => Promise.resolve(selectQueue.shift() ?? [])),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    insert: jest.fn().mockImplementation(() => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve([{ id: 'marker-1' }]) }),
        returning: () => Promise.resolve([{ id: 'batch-1' }]),
        then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      }),
    })),
  };
  // 트랜잭션 밖의 best-effort 후처리(약정 정리)가 db 를 직접 읽는다 — 빈 결과로 채워 노이즈를 없앤다.
  const db = {
    transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
  };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
  const publisher = { publishStatusChanged: jest.fn().mockResolvedValue(undefined) };
  const paymentClient = {
    terminateBillingMandate: jest
      .fn()
      .mockResolvedValue({ agreementFound: false, mandateTerminated: false, cancelledWithdrawals: 0 }),
  };
  const arrearsManager = {
    record: jest.fn().mockResolvedValue(true),
    outstandingTotal: jest.fn().mockResolvedValue(0),
  };

  const handler = new InvoiceOutcomeHandler(
    { db } as never,
    contractEventManager as never,
    publisher as never,
    paymentClient as never,
    arrearsManager as never,
  );
  return { handler, arrearsManager, contractEventManager };
}

const COVERING = { endsAt: '2026-08-07' };
const BILLED = { amount: 4990, currency: 'KRW', periodStart: '2026-07-07', periodEnd: '2026-08-07' };

describe('인보이스 터미널 실패 → 미수 원장', () => {
  it('UNCOLLECTIBLE: 인보이스 금액 그대로 적는다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);

    expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      userId: 'u1',
      contractId: 'c1',
      invoiceRef: 'inv-1',
      cause: 'UNCOLLECTIBLE',
      causeCode: 'Q301',
      amount: 4990,
      amountSource: 'INVOICE',
      periodEnd: '2026-08-07',
    });
  });

  it('MANDATE_REJECTED: 심사 거절도 미수다 — 출금 시도가 0회여도 자격은 썼다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleMandateRejected('c1', 'inv-1', 'Q201', BILLED);

    expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      cause: 'MANDATE_REJECTED',
      causeCode: 'Q201',
      amount: 4990,
    });
  });

  it('심사 기한초과는 별도 상태가 아니라 사유 코드로만 남는다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleMandateRejected('c1', 'inv-1', 'MANDATE_TIMEOUT', BILLED);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      cause: 'MANDATE_REJECTED',
      causeCode: 'MANDATE_TIMEOUT',
    });
  });

  it('자격을 한 번도 안 받았으면 미수를 안 적는다 — 공짜로 쓴 것이 없다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: null });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);
    expect(arrearsManager.record).not.toHaveBeenCalled();
  });

  it('자격이 청구 주기를 못 덮으면 미수를 안 적는다 — 선적용이 걸린 적 없는 주기다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: { endsAt: '2026-07-07' } });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);
    expect(arrearsManager.record).not.toHaveBeenCalled();
  });

  it('인보이스 행 없이 거절되면 플랜가로 유도하고 그 사실을 남긴다', async () => {
    const { handler, arrearsManager } = makeHandler({
      heldEntitlement: COVERING,
      plan: { price: 4990, currency: 'KRW' },
    });
    await handler.handleMandateRejected('c1', null, 'BILLING_METHOD_NOT_ACTIVE');

    expect(arrearsManager.record).toHaveBeenCalledTimes(1);
    expect(arrearsManager.record.mock.calls[0][1]).toMatchObject({
      invoiceRef: 'mandate-rejected:c1',
      amount: 4990,
      amountSource: 'PLAN_FALLBACK',
      periodEnd: null,
    });
  });

  it('금액을 끝내 못 정하면 미수를 안 적는다 — 0원 빚을 만들지 않는다', async () => {
    const { handler, arrearsManager } = makeHandler({ heldEntitlement: COVERING, plan: null });
    await handler.handleMandateRejected('c1', null, 'BILLING_METHOD_NOT_ACTIVE');
    expect(arrearsManager.record).not.toHaveBeenCalled();
  });

  it('원장에 새로 적혔을 때만 감사 이벤트를 남긴다', async () => {
    const { handler, contractEventManager } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);

    // addEvent(tx, contractId, eventType, metadata, causedBy, userId) — eventType 은 3번째 인자다.
    const types = contractEventManager.addEvent.mock.calls.map((c) => c[2]);
    expect(types).toContain('ARREARS_RECORDED');
  });
});
