import { format, subDays } from 'date-fns';
import { AttemptNoticeInput, InvoiceOutcomeHandler } from './invoice-outcome.handler';
import { BillingNoticeManager } from './billing-notice.manager';

/**
 * 출금 실패·미납 해지 고객 알림이 «정확히 한 번», 알릴 만한 경우에만 아웃박스에 실리는지 못 박는다.
 * 알림 경로가 결제 결과 처리(연체 표시·해지)를 막지 않는지도 함께 본다.
 */
function makeHandler(opts: {
  contract?: Record<string, unknown> | null;
  heldEntitlement?: { startsAt: string; endsAt: string } | null;
  markerIsNew?: boolean;
  contact?: { phoneNumber: string | null } | null;
  contactLookupFails?: boolean;
}) {
  const contract = opts.contract ?? {
    userId: 'u1',
    status: 'ACTIVE',
    autoRenewal: true,
    billingPath: 'INVOICE',
    nextBillingDate: '2026-09-01',
    recurringCancelledAt: null,
  };
  // limit() 이 도착하는 순서: ①계약(tx) ②보유 자격(tx, 회수 경로만)
  const selectQueue: unknown[][] = [contract ? [contract] : [], opts.heldEntitlement ? [opts.heldEntitlement] : []];

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
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(opts.markerIsNew === false ? [] : [{ id: 'marker-1' }]),
        }),
        returning: () => Promise.resolve([{ id: 'batch-1' }]),
        then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      }),
    })),
  };
  // 트랜잭션 밖: 알림용 계약 주인 조회(Manager) + 약정 정리(best-effort)
  const db = {
    transaction: jest.fn().mockImplementation((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(contract ? [{ userId: 'u1' }] : []),
  };
  const contractEventManager = { addEvent: jest.fn().mockResolvedValue(undefined) };
  const publisher = {
    publishStatusChanged: jest.fn().mockResolvedValue(undefined),
    saveBillingAttemptFailed: jest.fn().mockResolvedValue(undefined),
    saveTerminatedForNonPayment: jest.fn().mockResolvedValue(undefined),
  };
  const contactClient = {
    findContacts: jest.fn().mockImplementation(async () => {
      if (opts.contactLookupFails) throw new Error('timeout of 5000ms exceeded');
      const contact = opts.contact === undefined ? { phoneNumber: '01012345678' } : opts.contact;
      return new Map(
        contact
          ? [['u1', { userId: 'u1', email: 'a@b.c', username: '홍길동', marketingConsent: false, ...contact }]]
          : [],
      );
    }),
  };
  const paymentClient = {
    terminateBillingMandate: jest
      .fn()
      .mockResolvedValue({ agreementFound: false, mandateTerminated: false, cancelledWithdrawals: 0 }),
  };
  const arrearsManager = { record: jest.fn().mockResolvedValue(true), outstandingTotal: jest.fn() };
  const benefitReader = {
    findMembershipBenefitUsageSince: jest
      .fn()
      .mockResolvedValue({ totalDiscountAmount: 0, orderCount: 0, welcomeDeal: false }),
  };
  const termsRulesReader = { newRulesApply: jest.fn().mockResolvedValue(true) };

  const notice = new BillingNoticeManager(
    { db } as never,
    contactClient as never,
    publisher as never,
    contractEventManager as never,
  );
  const handler = new InvoiceOutcomeHandler(
    { db } as never,
    contractEventManager as never,
    publisher as never,
    paymentClient as never,
    arrearsManager as never,
    benefitReader as never,
    termsRulesReader as never,
    notice,
  );
  const eventTypes = () => contractEventManager.addEvent.mock.calls.map((c) => c[2]);
  const skipped = () => contractEventManager.addEvent.mock.calls.find((c) => c[2] === 'BILLING_NOTICE_SKIPPED')?.[3];
  const failedEvent = () => contractEventManager.addEvent.mock.calls.find((c) => c[2] === 'BILLING_FAILED')?.[3];
  return { handler, publisher, tx, eventTypes, skipped, failedEvent };
}

const ATTEMPT = {
  maxAttempts: 3,
  nextAttemptAt: '2026-09-03T00:00:00.000Z',
  billed: { amount: 4990, periodStart: '2026-09-01', periodEnd: '2026-09-30' },
};
const failAttempt = (h: InvoiceOutcomeHandler, attempt = 1, notice: AttemptNoticeInput = ATTEMPT) =>
  h.handlePaymentFailed('c1', 'inv-1', `pi-${attempt}`, attempt, 'E1', '  잔액   부족 ', notice);

describe('출금 실패 알림', () => {
  it('1회차 실패: 남은 횟수·다음 요청 시각·주기·금액을 실어 한 번 싣는다', async () => {
    const { handler, publisher, eventTypes } = makeHandler({});
    await failAttempt(handler);

    expect(publisher.saveBillingAttemptFailed).toHaveBeenCalledTimes(1);
    const [payload, , key] = publisher.saveBillingAttemptFailed.mock.calls[0];
    expect(payload).toMatchObject({
      userId: 'u1',
      userName: '홍길동',
      phoneNumber: '01012345678',
      invoiceId: 'inv-1',
      attemptCount: 1,
      maxAttempts: 3,
      remainingAttempts: 2,
      nextAttemptRequestAt: '2026-09-03T00:00:00.000Z',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      amount: 4990,
      reasonText: '잔액 부족',
    });
    expect(key).toBe('membership:billing-failed:pi-1');
    expect(eventTypes()).toEqual(expect.arrayContaining(['BILLING_FAILED', 'BILLING_NOTICE_QUEUED']));
  });

  it('실패 기록에 다음 출금 시각을 남긴다 — 관리자 화면이 «다음 시도»를 추정하지 않게', async () => {
    const { handler, failedEvent } = makeHandler({});
    await failAttempt(handler);
    expect(failedEvent()).toMatchObject({
      invoiceId: 'inv-1',
      attemptNo: 1,
      nextAttemptAt: '2026-09-03T00:00:00.000Z',
    });
  });

  it('같은 실패가 다시 오면(마커 충돌) 싣지 않는다', async () => {
    const { handler, publisher } = makeHandler({ markerIsNew: false });
    await failAttempt(handler);
    expect(publisher.saveBillingAttemptFailed).not.toHaveBeenCalled();
  });

  it('이미 끝난 계약의 뒤늦은 실패는 알리지 않는다', async () => {
    const { handler, publisher } = makeHandler({
      contract: { userId: 'u1', status: 'CANCELLED', autoRenewal: false, billingPath: 'INVOICE' },
    });
    await failAttempt(handler);
    expect(publisher.saveBillingAttemptFailed).not.toHaveBeenCalled();
  });

  it('남은 시도가 없는 실패는 해지 안내가 대신하므로 싣지 않는다', async () => {
    const { handler, publisher } = makeHandler({});
    await failAttempt(handler, 3);
    expect(publisher.saveBillingAttemptFailed).not.toHaveBeenCalled();
  });

  it('옛 wallet 이 주기·금액을 안 실어 와도 보낸다(해당 필드만 빠진다)', async () => {
    const { handler, publisher } = makeHandler({});
    await failAttempt(handler, 1, { maxAttempts: 3, nextAttemptAt: ATTEMPT.nextAttemptAt, billed: {} });
    const [payload] = publisher.saveBillingAttemptFailed.mock.calls[0];
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('periodStart');
  });

  it('전화번호가 없으면 싣지 않고 건너뛴 이유를 남긴다', async () => {
    const { handler, publisher, skipped } = makeHandler({ contact: { phoneNumber: null } });
    await failAttempt(handler);
    expect(publisher.saveBillingAttemptFailed).not.toHaveBeenCalled();
    expect(skipped()).toEqual({ kind: 'ATTEMPT_FAILED', reason: 'NO_PHONE' });
  });

  it('연락처 조회가 죽어도 실패 처리(연체 표시)는 끝까지 하고, 알림만 건너뛴다', async () => {
    const { handler, publisher, tx, eventTypes, skipped } = makeHandler({ contactLookupFails: true });
    await expect(failAttempt(handler)).resolves.toBeUndefined();

    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ isPastDue: true }));
    expect(eventTypes()).toContain('BILLING_FAILED');
    expect(publisher.saveBillingAttemptFailed).not.toHaveBeenCalled();
    expect(skipped()).toEqual({ kind: 'ATTEMPT_FAILED', reason: 'CONTACT_LOOKUP_FAILED' });
  });
});

describe('미납 해지 알림', () => {
  const COVERING = { startsAt: '2026-08-01', endsAt: '2026-09-30' };
  const BILLED = { amount: 4990, currency: 'KRW', periodStart: '2026-08-01', periodEnd: '2026-08-31' };

  it('재시도 소진 + 미납 기록: 미납 금액을 실어 계약당 한 번 싣는다', async () => {
    const { handler, publisher } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);

    expect(publisher.saveTerminatedForNonPayment).toHaveBeenCalledTimes(1);
    const [payload, , key] = publisher.saveTerminatedForNonPayment.mock.calls[0];
    expect(payload).toMatchObject({ arrearsAmount: 4990, arrearsSkippedReason: null, periodStart: '2026-08-01' });
    expect(key).toBe('membership:terminated-notice:c1');
  });

  it('청약철회 대상 주기라 미납을 안 적었으면 금액 없이 이유를 싣는다', async () => {
    const day = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');
    const { handler, publisher } = makeHandler({ heldEntitlement: { startsAt: day(2), endsAt: day(-28) } });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', {
      amount: 4990,
      currency: 'KRW',
      periodStart: day(2),
      periodEnd: day(-28),
    });

    const [payload] = publisher.saveTerminatedForNonPayment.mock.calls[0];
    expect(payload).toMatchObject({ arrearsAmount: null, arrearsSkippedReason: 'WITHDRAWAL_ELIGIBLE' });
  });

  it('계좌 심사 거절 해지도 «해지됐다»를 알리고 원인을 싣는다 — 재등록 안내 메일과는 다른 안내다', async () => {
    const { handler, publisher } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleMandateRejected('c1', 'inv-1', 'Q201', BILLED);
    expect(publisher.saveTerminatedForNonPayment).toHaveBeenCalledTimes(1);
    expect(publisher.saveTerminatedForNonPayment.mock.calls[0][0]).toMatchObject({
      cause: 'MANDATE_REJECTED',
      arrearsAmount: 4990,
    });
  });

  it('관리자 무효화(voided)는 알리지 않는다', async () => {
    const { handler, publisher } = makeHandler({ heldEntitlement: COVERING });
    await handler.handleVoided('c1', 'inv-1', null);
    expect(publisher.saveTerminatedForNonPayment).not.toHaveBeenCalled();
  });

  it('이미 끝난 계약이면 싣지 않는다', async () => {
    const { handler, publisher } = makeHandler({
      contract: { userId: 'u1', status: 'EXPIRED', autoRenewal: false, billingPath: 'INVOICE' },
      heldEntitlement: COVERING,
    });
    await handler.handleUncollectible('c1', 'inv-1', 'Q301', BILLED);
    expect(publisher.saveTerminatedForNonPayment).not.toHaveBeenCalled();
  });
});
