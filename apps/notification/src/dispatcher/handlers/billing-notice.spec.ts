import { MembershipEventConsumer } from './membership-event.consumer';
import { formatBillingPeriod, formatKstMonthDay, nextSendableAt, nhnRequestDateIfQuiet } from './billing-notice.format';

describe('출금 실패 알림 — 표기', () => {
  it('다음 출금 요청 시각은 한국 날짜로 읽는다 (UTC 로는 전날 밤)', () => {
    expect(formatKstMonthDay('2026-09-02T16:00:00.000Z')).toBe('9월 3일');
    expect(formatKstMonthDay('2026-09-03')).toBe('9월 3일');
  });

  it('청구 주기는 해를 넘길 때만 연도를 붙이고, 모르면 「이번 주기」', () => {
    expect(formatBillingPeriod('2026-09-01', '2026-09-30')).toBe('9월 1일~9월 30일');
    expect(formatBillingPeriod('2026-12-15', '2027-01-14')).toBe('12월 15일~2027년 1월 14일');
    expect(formatBillingPeriod(undefined, '2026-09-30')).toBe('이번 주기');
  });

  it.each([
    // [UTC 시각, 한국 시각 설명, 기대 발송 시각(UTC)]
    ['2026-09-29T11:59:00.000Z', '20:59 → 그대로', '2026-09-29T11:59:00.000Z'],
    ['2026-09-29T12:00:00.000Z', '21:00 → 다음 날 08:00', '2026-09-29T23:00:00.000Z'],
    ['2026-09-29T22:59:00.000Z', '07:59 → 같은 날 08:00', '2026-09-29T23:00:00.000Z'],
    ['2026-09-29T23:00:00.000Z', '08:00 → 그대로', '2026-09-29T23:00:00.000Z'],
    ['2026-09-29T15:30:00.000Z', '00:30 → 같은 날 08:00', '2026-09-29T23:00:00.000Z'],
  ])('%s (%s)', (now, _label, expected) => {
    expect(nextSendableAt(new Date(now)).toISOString()).toBe(expected);
  });
});

describe('MembershipEventConsumer — 출금 실패·미납 해지 알림톡', () => {
  const makeConsumer = (isActive = true) => {
    const dispatcher = { send: jest.fn().mockResolvedValue({ notificationIds: ['n1'] }) };
    const eventMapping = {
      getEventMapping: jest.fn().mockImplementation(async (eventKey: string) => ({
        isActive,
        defaultChannels: ['KAKAO'],
        category: 'TRANSACTIONAL',
        templateKey: eventKey,
        eventKey,
        priority: 'HIGH',
      })),
    };
    const consumer = new MembershipEventConsumer(dispatcher as never, eventMapping as never, {} as never);
    return { consumer, dispatcher, eventMapping };
  };

  const failed = {
    userId: 'u1',
    userName: '홍길동',
    phoneNumber: '01012345678',
    contractId: 'c1',
    invoiceId: 'inv-1',
    periodStart: '2026-09-01',
    periodEnd: '2026-09-30',
    amount: 4990,
    attemptCount: 1,
    maxAttempts: 3,
    remainingAttempts: 2,
    nextAttemptRequestAt: '2026-09-03T00:00:00.000Z',
    reasonText: '잔액 부족',
    occurredAt: '2026-09-01T01:00:00.000Z',
  };

  it('출금 실패: 변수를 다 만들고, 대체 문자·멱등키·연락처를 싣는다', async () => {
    const { consumer, dispatcher } = makeConsumer();
    await consumer.onBillingAttemptFailed({ correlationId: 'corr' } as never, failed);

    const dto = dispatcher.send.mock.calls[0][0];
    expect(dto.eventKey).toBe('MEMBERSHIP_BILLING_ATTEMPT_FAILED');
    expect(dto.variables).toEqual({
      name: '홍길동',
      period: '9월 1일~9월 30일',
      amount: '4,990원',
      attempt: 1,
      reason: '잔액 부족',
      nextDate: '9월 3일',
      remaining: 2,
    });
    expect(dto.payload).toEqual({ name: '홍길동', phoneNumber: '01012345678' });
    expect(dto.metadata).toEqual({ smsFallback: true });
    expect(dto.idempotencyKey).toBe('membership:billing-failed:inv-1:1');
    expect(dto.sendAt).toEqual(expect.any(String));
  });

  it('은행 사유가 없으면 일반 문구로 채운다', async () => {
    const { consumer, dispatcher } = makeConsumer();
    await consumer.onBillingAttemptFailed({} as never, { ...failed, reasonText: null });
    expect(dispatcher.send.mock.calls[0][0].variables.reason).toBe('은행에서 출금이 거절됐어요');
  });

  it('미납 해지: 미납 금액이 있으면 「미납 있음」 템플릿으로 금액을 넘긴다', async () => {
    const { consumer, dispatcher } = makeConsumer();
    await consumer.onTerminatedForNonPayment({} as never, {
      userId: 'u1',
      userName: '홍길동',
      phoneNumber: '01012345678',
      contractId: 'c1',
      invoiceId: 'inv-1',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      arrearsAmount: 4990,
      arrearsSkippedReason: null,
      occurredAt: '2026-09-07T01:00:00.000Z',
    });

    const dto = dispatcher.send.mock.calls[0][0];
    expect(dto.eventKey).toBe('MEMBERSHIP_TERMINATED_WITH_ARREARS');
    expect(dto.variables).toEqual({ name: '홍길동', period: '9월 1일~9월 30일', arrearsAmount: '4,990원' });
    expect(dto.idempotencyKey).toBe('membership:terminated-notice:c1');
  });

  it('미납 해지: 미납이 없으면 「미납 없음」 템플릿', async () => {
    const { consumer, dispatcher } = makeConsumer();
    await consumer.onTerminatedForNonPayment({} as never, {
      userId: 'u1',
      userName: '홍길동',
      phoneNumber: '01012345678',
      contractId: 'c1',
      invoiceId: 'inv-1',
      arrearsAmount: null,
      arrearsSkippedReason: 'WITHDRAWAL_ELIGIBLE',
      occurredAt: '2026-09-07T01:00:00.000Z',
    });

    const dto = dispatcher.send.mock.calls[0][0];
    expect(dto.eventKey).toBe('MEMBERSHIP_TERMINATED_NO_ARREARS');
    expect(dto.variables).toEqual({ name: '홍길동', period: '이번 주기' });
  });

  it('매핑이 꺼져 있으면(카카오 심사 전) 보내지 않는다', async () => {
    const { consumer, dispatcher } = makeConsumer(false);
    await consumer.onBillingAttemptFailed({} as never, failed);
    expect(dispatcher.send).not.toHaveBeenCalled();
  });
});

describe('밤 시간 알림은 NHN 예약 발송으로 미룬다', () => {
  it.each([
    ['2026-09-29T11:59:00.000Z', null],
    ['2026-09-29T12:00:00.000Z', '2026-09-30 08:00'],
    ['2026-09-29T15:30:00.000Z', '2026-09-30 08:00'],
    ['2026-09-29T23:00:00.000Z', null],
  ])('%s → %s', (now, expected) => {
    expect(nhnRequestDateIfQuiet(new Date(now))).toBe(expected);
  });
});
