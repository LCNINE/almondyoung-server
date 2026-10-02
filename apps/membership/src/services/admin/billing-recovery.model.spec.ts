import {
  ClassifiedCase,
  RecoveryCaseRow,
  classifyCase,
  kstWeekStart,
  summarizeCases,
  weeklyTrend,
} from './billing-recovery.model';

const NOW = new Date('2026-10-02T03:00:00.000Z'); // 10/2 12:00 KST
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

const base = (over: Partial<RecoveryCaseRow> = {}): RecoveryCaseRow => ({
  kind: 'WITHDRAWAL',
  contractId: 'c1',
  userId: 'u1',
  invoiceId: 'inv-1',
  startedAt: daysAgo(1),
  lastFailedAt: daysAgo(1),
  attempts: 1,
  failures: [],
  lastErrorCode: 'Q201',
  lastErrorMessage: null,
  nextAttemptAt: null,
  recoveredAt: null,
  recoveredAmount: null,
  terminatedAt: null,
  terminatedReason: null,
  contractStatus: 'ACTIVE',
  planPrice: 4990,
  arrears: null,
  arrearsSkippedReason: null,
  attemptNotices: [],
  finalNotice: null,
  ...over,
});

const classify = (over: Partial<RecoveryCaseRow> = {}) => classifyCase(base(over), NOW);

describe('출금 실패 건 판정', () => {
  it('성공 기록이 있으면 다른 무엇보다 «회수»다', () => {
    const c = classify({ recoveredAt: daysAgo(0), recoveredAmount: 4990, contractStatus: 'CANCELLED' });
    expect(c.stage).toBe('RECOVERED');
    expect(c.debtState).toBeNull();
  });

  it('재시도 소진 해지 + 미납 줄 → 해지·미납 남음, 납부 진행 중이면 PAYING', () => {
    const arrears = {
      id: 'a1',
      amount: 4990,
      status: 'OUTSTANDING' as const,
      paying: false,
      createdAt: daysAgo(0),
      settledAt: null,
    };
    const c = classify({ attempts: 3, terminatedAt: daysAgo(0), terminatedReason: 'UNCOLLECTIBLE:Q301', arrears });
    expect([c.stage, c.terminationKind, c.debtState]).toEqual(['TERMINATED', 'EXHAUSTED', 'OUTSTANDING']);
    expect(
      classify({ terminatedAt: daysAgo(0), terminatedReason: 'UNCOLLECTIBLE:-', arrears: { ...arrears, paying: true } })
        .debtState,
    ).toBe('PAYING');
  });

  it('해지됐는데 미납 줄이 없으면 0원으로 뭉개지 않고 «안 적음»으로 둔다', () => {
    const c = classify({
      terminatedAt: daysAgo(0),
      terminatedReason: 'UNCOLLECTIBLE:Q301',
      arrearsSkippedReason: 'TERMS_NOT_IN_FORCE',
    });
    expect(c.debtState).toBe('NOT_RECORDED');
  });

  it('청구 취소(voided) 해지는 돈을 못 걷은 해지가 아니다 — 미납·해지 안내 대상이 아니다', () => {
    const c = classify({ terminatedAt: daysAgo(0), terminatedReason: 'INVOICE_VOIDED:admin' });
    expect([c.terminationKind, c.debtState, c.finalNoticeExpected]).toEqual(['VOIDED', null, false]);
  });

  it('출금 전 계좌 거절 건은 사유와 무관하게 MANDATE_REJECTED', () => {
    const c = classify({
      kind: 'MANDATE',
      attempts: 0,
      lastFailedAt: null,
      terminatedAt: daysAgo(0),
      terminatedReason: 'MANDATE_REJECTED:-',
    });
    expect([c.stage, c.terminationKind, c.finalNoticeExpected]).toEqual(['TERMINATED', 'MANDATE_REJECTED', true]);
    expect(c.attemptNoticesMissing).toEqual([]);
  });

  it('결과 없이 계약만 끝났으면(본인 해지 등) 재시도 중으로 세지 않는다', () => {
    expect(classify({ contractStatus: 'CANCELLED' }).stage).toBe('ENDED_OTHER');
  });

  it('마지막 실패 뒤 7일이 넘도록 결과가 없으면 «결과 안 옴»', () => {
    expect(classify({ lastFailedAt: daysAgo(7.5), startedAt: daysAgo(9) }).stage).toBe('AWAITING_RESULT');
    expect(classify({ lastFailedAt: daysAgo(6.5) }).stage).toBe('RETRYING');
  });

  it('다음 출금 시각: 기록이 있으면 그대로, 없으면 마지막 실패 + 48시간을 «추정»으로', () => {
    expect(classify({ nextAttemptAt: '2026-10-03T15:00:00.000Z' }).nextAttempt).toEqual({
      at: '2026-10-03T15:00:00.000Z',
      estimated: false,
    });
    expect(classify({ lastFailedAt: hoursAgo(10) }).nextAttempt).toEqual({ at: hoursAgo(-38), estimated: true });
  });

  it('남은 기회 0 인 실패(3회차 실패 직후 해지 대기)에는 다음 출금이 없다', () => {
    const c = classify({ attempts: 3 });
    expect([c.remainingAttempts, c.nextAttempt]).toEqual([0, null]);
  });

  it('회차 알림은 1 ~ (최대-1) 회차만 기대한다 — 마지막 실패는 해지 안내가 대신한다', () => {
    const c = classify({ attempts: 3, attemptNotices: [{ attemptNo: 1, state: 'QUEUED', reason: null }] });
    expect(c.attemptNoticesMissing).toEqual([2]);
  });
});

describe('퍼널 요약', () => {
  const cases: ClassifiedCase[] = [
    classify({ userId: 'a', recoveredAt: daysAgo(0), recoveredAmount: 4990, startedAt: daysAgo(2) }),
    classify({ userId: 'b', recoveredAt: daysAgo(0), recoveredAmount: null, startedAt: daysAgo(4) }),
    classify({ userId: 'c', attempts: 2, attemptNotices: [{ attemptNo: 1, state: 'SKIPPED', reason: 'NO_PHONE' }] }),
    classify({
      userId: 'd',
      attempts: 3,
      terminatedAt: daysAgo(0),
      terminatedReason: 'UNCOLLECTIBLE:Q301',
      arrears: {
        id: 'x',
        amount: 4990,
        status: 'SETTLED',
        paying: false,
        createdAt: daysAgo(4),
        settledAt: daysAgo(1),
      },
      finalNotice: { state: 'QUEUED', reason: null },
    }),
    classify({
      userId: 'e',
      kind: 'MANDATE',
      attempts: 0,
      lastFailedAt: null,
      terminatedAt: daysAgo(0),
      terminatedReason: 'MANDATE_REJECTED:Q201',
      arrearsSkippedReason: 'WITHDRAWAL_ELIGIBLE',
    }),
    classify({ userId: 'f', terminatedAt: daysAgo(0), terminatedReason: 'UNCOLLECTIBLE:Q301' }),
  ];
  const { funnel, kpis } = summarizeCases(cases);

  it('출금 실패 건과 계좌 거절 건을 갈라 센다', () => {
    expect(funnel.withdrawalFailed).toEqual({ cases: 5, people: 5, amount: 5 * 4990 });
    expect(funnel.mandateRejected).toMatchObject({ cases: 1, people: 1 });
  });

  it('받은 돈을 모르는 회수 건은 0원으로 더하지 않고 따로 센다', () => {
    expect(funnel.recovered).toEqual({ cases: 2, amount: 4990, amountUnknownCases: 1 });
  });

  it('재시도 회수율은 결과가 난 건만 분모로 — 진행 중은 따로', () => {
    expect(funnel.exhausted.cases).toBe(2);
    expect(kpis.retryRecoveryRate).toBeCloseTo(2 / 4);
    expect([kpis.retryResolved, kpis.retryUnresolved]).toEqual([4, 1]);
  });

  it('미납: 적은 것·받은 것·안 적은 이유', () => {
    expect(funnel.debt.recorded).toEqual({ cases: 1, amount: 4990 });
    expect(funnel.debt.settled).toEqual({ cases: 1, amount: 4990 });
    expect(funnel.debt.notRecorded).toEqual({ WITHDRAWAL_ELIGIBLE: 1, UNRECORDED: 1 });
    expect(kpis.debtCollectionRate).toBe(1);
    expect(kpis.avgDaysToSettle).toBe(3);
  });

  it('알림: 접수·건너뜀·기록 없음', () => {
    // 회수 a·b 각 1, 재시도 c 의 2회차 1, 소진 d 의 1·2회차 2, 소진 f 1
    expect(funnel.notices.attempt).toEqual({ queued: 0, skipped: 1, missing: 6 });
    expect(funnel.notices.final).toEqual({ queued: 1, skipped: 0, missing: 2 });
    expect(funnel.notices.skippedReasons).toEqual({ NO_PHONE: 1 });
  });

  it('평균 회수 일수는 첫 실패부터 성공까지', () => {
    expect(kpis.avgDaysToRecover).toBe(3);
  });

  it('건이 없으면 비율은 0 이 아니라 null', () => {
    expect(summarizeCases([]).kpis).toMatchObject({
      retryRecoveryRate: null,
      debtCollectionRate: null,
      avgDaysToRecover: null,
    });
  });
});

describe('주 단위 추이', () => {
  it('주 시작은 한국 시간 월요일 0시', () => {
    // 2026-10-02 는 금요일 → 그 주 월요일 9/28 00:00 KST = 9/27 15:00 UTC
    expect(kstWeekStart(NOW).toISOString()).toBe('2026-09-27T15:00:00.000Z');
    // 일요일 밤 23시 KST 는 아직 앞 주
    expect(kstWeekStart(new Date('2026-09-27T14:00:00.000Z')).toISOString()).toBe('2026-09-20T15:00:00.000Z');
  });

  it('실패는 시작한 주, 회수는 회수한 주, 미납은 생긴 주와 받은 주에 들어간다', () => {
    const points = weeklyTrend(
      [classify({ startedAt: daysAgo(9), lastFailedAt: daysAgo(9), recoveredAt: daysAgo(1), recoveredAmount: 4990 })],
      [{ amount: 4990, status: 'SETTLED', createdAt: daysAgo(9), settledAt: daysAgo(1) }],
      NOW,
      3,
    );
    expect(points.map((p) => p.week)).toEqual(['2026-09-14', '2026-09-21', '2026-09-28']);
    expect(points.map((p) => [p.failedCases, p.recoveredCases, p.debtCreated, p.debtSettled])).toEqual([
      [0, 0, 0, 0],
      [1, 0, 4990, 0],
      [0, 1, 0, 4990],
    ]);
  });
});

describe('미납 정책 시행 전후', () => {
  const POLICY = new Date(Date.parse(daysAgo(2))); // 이틀 전 시행

  it('시행 전에 시작된 건은 BEFORE_POLICY, 후는 UNDER_POLICY — 경계를 모르면 모두 시행 후', () => {
    expect(classifyCase(base({ startedAt: daysAgo(3) }), NOW, POLICY).era).toBe('BEFORE_POLICY');
    expect(classifyCase(base({ startedAt: daysAgo(1) }), NOW, POLICY).era).toBe('UNDER_POLICY');
    expect(classifyCase(base({ startedAt: daysAgo(3) }), NOW, null).era).toBe('UNDER_POLICY');
  });

  it('시행 전 실패 회차는 «알림 기록 없음»이 아니라 «시행 전»으로 센다 — 회차마다 실패 시각으로 판정', () => {
    const c = classifyCase(
      base({
        startedAt: daysAgo(3),
        attempts: 2,
        failures: [
          { attemptNo: 1, at: daysAgo(3) },
          { attemptNo: 2, at: daysAgo(1) },
        ],
        lastFailedAt: daysAgo(1),
      }),
      NOW,
      POLICY,
    );
    expect([c.attemptNoticesBeforePolicy, c.attemptNoticesMissing]).toEqual([[1], [2]]);
  });

  it('해지 안내는 해지 시각이 시행 후일 때만 기대한다', () => {
    const terminated = (at: string) =>
      classifyCase(base({ attempts: 3, terminatedAt: at, terminatedReason: 'UNCOLLECTIBLE:Q301' }), NOW, POLICY);
    expect(terminated(daysAgo(3)).finalNoticeExpected).toBe(false);
    expect(terminated(daysAgo(1)).finalNoticeExpected).toBe(true);
  });
});
