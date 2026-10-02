import type {
  BillingRecoveryOverview,
  RecoveryCase,
} from '@/lib/api/domains/membership/recovery';
import type { MembershipNoticeStatus } from '@/lib/api/domains/alimtalk';
import {
  briefing,
  caseNowLabel,
  failureReason,
  inFlowNode,
  kstDay,
  noticeBadge,
  noticeLookupFor,
  noNoticeBecauseBeforePolicy,
  scopedOverview,
} from './recovery-view';

const kase = (over: Partial<RecoveryCase> = {}): RecoveryCase => ({
  kind: 'WITHDRAWAL',
  contractId: 'c1',
  userId: 'u1',
  invoiceId: 'inv-1',
  startedAt: '2026-10-01T00:00:00.000Z',
  lastFailedAt: '2026-10-01T00:00:00.000Z',
  attempts: 1,
  failures: [],
  lastErrorCode: null,
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
  stage: 'RETRYING',
  era: 'UNDER_POLICY',
  terminationKind: null,
  debtState: null,
  remainingAttempts: 2,
  nextAttempt: null,
  attemptNoticesMissing: [],
  attemptNoticesBeforePolicy: [],
  finalNoticeExpected: false,
  ...over,
});

const amount = (cases = 0, amount = 0) => ({ cases, amount });

const overview = (over: {
  funnel?: Partial<BillingRecoveryOverview['funnel']>;
  debt?: Partial<BillingRecoveryOverview['funnel']['debt']>;
  outstanding?: { amount: number; people: number };
  cohort?: RecoveryCase[];
  beforePolicy?: BillingRecoveryOverview['beforePolicy'];
}): BillingRecoveryOverview =>
  ({
    asOf: '2026-10-02T00:00:00.000Z',
    period: { month: '2026-10', from: '', toExclusive: '' },
    policy: { effectiveAt: '2026-09-29T15:00:00.000Z' },
    beforePolicy: over.beforePolicy ?? null,
    funnel: {
      withdrawalFailed: { ...amount(), people: 0 },
      recovered: { ...amount(), amountUnknownCases: 0 },
      retrying: { ...amount(), lastChance: 0 },
      awaitingResult: amount(),
      endedOther: amount(),
      voided: amount(),
      exhausted: amount(),
      mandateRejected: { ...amount(), people: 0 },
      debt: {
        recorded: amount(),
        outstanding: amount(),
        paying: amount(),
        settled: amount(),
        waived: amount(),
        notRecorded: {},
        ...over.debt,
      },
      notices: {
        attempt: { queued: 0, skipped: 0, missing: 0 },
        final: { queued: 0, skipped: 0, missing: 0 },
        skippedReasons: {},
      },
      ...over.funnel,
    },
    kpis: {} as BillingRecoveryOverview['kpis'],
    cohort: { cases: over.cohort ?? [], truncated: false },
    now: {
      outstanding: over.outstanding ?? { amount: 0, people: 0 },
      alerts: {} as BillingRecoveryOverview['now']['alerts'],
      lanes: {} as BillingRecoveryOverview['now']['lanes'],
      legacyRetrying: 0,
    },
    trend: [],
  }) as BillingRecoveryOverview;

describe('한 줄 브리핑', () => {
  it('아무 일도 없던 달', () => {
    expect(briefing(overview({}))).toEqual([
      '10월에는 출금 실패도, 계좌 거절 해지도 없었습니다.',
      '지금 남아 있는 미납은 없습니다.',
    ]);
  });

  it('회수·해지·재시도·미납이 섞인 달을 문장으로 푼다', () => {
    const lines = briefing(
      overview({
        funnel: {
          withdrawalFailed: { cases: 9, amount: 0, people: 8 },
          recovered: { cases: 4, amount: 19960, amountUnknownCases: 0 },
          exhausted: amount(3, 0),
          retrying: { cases: 2, amount: 0, lastChance: 1 },
          mandateRejected: { cases: 1, amount: 0, people: 1 },
        },
        debt: {
          recorded: amount(3, 14970),
          settled: amount(2, 9980),
          outstanding: amount(1, 4990),
        },
        outstanding: { amount: 12000, people: 3 },
        cohort: [
          kase({ kind: 'MANDATE', terminationKind: 'MANDATE_REJECTED' }),
        ],
      })
    );
    expect(lines).toEqual([
      '10월에 출금이 실패한 청구 9건(8명), 출금 전 계좌 거절 해지 1건이 있었습니다.',
      '그중 4건은 재시도로 받았고(19,960원), 3건은 끝내 실패해 해지됐습니다.',
      '2건은 아직 재시도 중입니다(그중 1건은 다음 출금이 마지막 기회).',
      '해지로 생긴 미납 14,970원 중 9,980원을 받았고 4,990원이 남아 있습니다.',
      '지금 받을 돈은 모두 12,000원(3명)입니다.',
    ]);
  });

  it('미납을 아직 못 받았거나 다 받은 달', () => {
    const notYet = briefing(
      overview({
        funnel: {
          withdrawalFailed: { cases: 1, amount: 0, people: 1 },
          exhausted: amount(1, 0),
        },
        debt: { recorded: amount(1, 4990), paying: amount(1, 4990) },
      })
    );
    expect(notYet).toContain(
      '해지로 생긴 미납 4,990원은 아직 받지 못했습니다(그중 4,990원은 고객이 입금을 시작함).'
    );
    const done = briefing(
      overview({
        funnel: {
          withdrawalFailed: { cases: 2, amount: 0, people: 2 },
          exhausted: amount(2, 0),
        },
        debt: {
          recorded: amount(2, 9980),
          settled: amount(1, 4990),
          waived: amount(1, 4990),
        },
      })
    );
    expect(done).toContain(
      '해지로 생긴 미납 9,980원 중 4,990원을 받았고 4,990원은 면제했습니다 — 남은 돈은 없습니다.'
    );
  });

  it('받은 돈을 모르는 회수 건은 금액에 더하지 않고 따로 말한다', () => {
    const lines = briefing(
      overview({
        funnel: {
          withdrawalFailed: { cases: 2, amount: 0, people: 2 },
          recovered: { cases: 2, amount: 4990, amountUnknownCases: 1 },
        },
      })
    );
    expect(lines[1]).toBe(
      '그중 2건은 재시도로 받았습니다(4,990원 + 금액 기록 없는 1건).'
    );
  });

  it('출금 실패 뒤 계좌 거절로 끝난 건은 «출금 전 거절»로 세지 않는다', () => {
    const lines = briefing(
      overview({
        funnel: {
          withdrawalFailed: { cases: 1, amount: 0, people: 1 },
          mandateRejected: { cases: 1, amount: 0, people: 1 },
        },
        cohort: [
          kase({ terminationKind: 'MANDATE_REJECTED', stage: 'TERMINATED' }),
        ],
      })
    );
    expect(lines[0]).toBe('10월에 출금이 실패한 청구 1건(1명)이 있었습니다.');
  });
});

describe('알림 상태', () => {
  const statuses = new Map<string, MembershipNoticeStatus>([
    [
      'attempt:inv-1:1',
      {
        ref: 'attempt:inv-1:1',
        found: true,
        notificationId: 'n1',
        status: 'SENT',
        sentAt: null,
        scheduledFor: '2026-10-02 08:00',
        error: null,
      },
    ],
    [
      'attempt:inv-1:2',
      {
        ref: 'attempt:inv-1:2',
        found: false,
        notificationId: null,
        status: null,
        sentAt: null,
        scheduledFor: null,
        error: null,
      },
    ],
    [
      'terminated:c1',
      {
        ref: 'terminated:c1',
        found: true,
        notificationId: 'n2',
        status: 'FAILED',
        sentAt: null,
        scheduledFor: null,
        error: 'x',
      },
    ],
  ]);
  const queued = { state: 'QUEUED' as const, reason: null };

  it('기록이 없으면 «안 감»이 아니라 «기록 없음»', () => {
    expect(noticeBadge(null, null, statuses)).toEqual({
      tone: 'muted',
      text: '알림 기록 없음',
    });
  });
  it('못 보낸 건 이유까지', () => {
    expect(
      noticeBadge({ state: 'SKIPPED', reason: 'NO_PHONE' }, null, statuses).text
    ).toBe('알림 못 보냄 · 전화번호 없음');
  });
  it('카카오 접수·예약·접수 실패·보내는 중', () => {
    expect(noticeBadge(queued, 'attempt:inv-1:1', statuses)).toEqual({
      tone: 'ok',
      text: '카카오 접수 · 10/02 08:00 예약',
    });
    expect(noticeBadge(queued, 'attempt:inv-1:2', statuses).text).toBe(
      '알림 보내는 중'
    );
    expect(noticeBadge(queued, 'terminated:c1', statuses)).toEqual({
      tone: 'warn',
      text: '카카오 접수 실패',
    });
  });
  it('알림 서비스를 못 물었으면 멤버십 기록만으로 말한다', () => {
    expect(noticeBadge(queued, 'attempt:inv-1:1', undefined)).toEqual({
      tone: 'pending',
      text: '알림 보냄',
    });
  });

  it('접수된 안내만 묻는다 — 건너뛴 안내와 기록 없는 회차는 물을 것이 없다', () => {
    const lookup = noticeLookupFor(
      [
        kase({
          attemptNotices: [
            { attemptNo: 1, state: 'QUEUED', reason: null },
            { attemptNo: 2, state: 'SKIPPED', reason: 'NO_PHONE' },
          ],
          finalNotice: queued,
        }),
      ],
      [
        {
          userId: 'u2',
          contractId: 'c2',
          amount: 1,
          lines: 1,
          oldestAt: '',
          causes: [],
          paying: false,
          finalNotice: queued,
        },
      ]
    );
    expect(lookup).toEqual({
      attempts: [{ invoiceId: 'inv-1', attemptNo: 1 }],
      terminations: [{ contractId: 'c1' }, { contractId: 'c2' }],
    });
  });
});

describe('건 표기', () => {
  it('실패 사유: 은행 원문 → 코드 매핑 → 코드', () => {
    expect(
      failureReason({ lastErrorMessage: '잔액부족', lastErrorCode: 'Q201' })
    ).toBe('잔액부족');
    expect(
      failureReason({ lastErrorMessage: null, lastErrorCode: 'Q101' })
    ).toBe('계좌번호 오류');
    expect(failureReason({ lastErrorMessage: null, lastErrorCode: 'Z9' })).toBe(
      '사유 코드 Z9'
    );
    expect(failureReason({ lastErrorMessage: null, lastErrorCode: null })).toBe(
      '사유 기록 없음'
    );
  });

  it('지금 어디인지 한 마디로', () => {
    expect(caseNowLabel(kase({ remainingAttempts: 1 }))).toBe(
      '재시도 중 · 마지막 기회'
    );
    expect(
      caseNowLabel(
        kase({
          stage: 'TERMINATED',
          terminationKind: 'EXHAUSTED',
          debtState: 'PAYING',
        })
      )
    ).toBe('해지 · 입금 대기');
  });

  it('퍼널 칸 판정은 서버 퍼널과 같은 필드만 본다', () => {
    const c = kase({
      stage: 'TERMINATED',
      terminationKind: 'EXHAUSTED',
      debtState: 'NOT_RECORDED',
    });
    expect(
      ['failed', 'exhausted', 'notRecorded'].every((n) =>
        inFlowNode(c, n as never)
      )
    ).toBe(true);
    expect(inFlowNode(c, 'debtRecorded')).toBe(false);
  });

  it('날짜는 한국 시간', () => {
    expect(kstDay('2026-10-02T15:30:00.000Z')).toBe('10/3(토)');
  });
});

describe('미납 정책 시행 전후', () => {
  const before = {
    funnel: overview({
      funnel: { withdrawalFailed: { cases: 3, amount: 0, people: 3 } },
    }).funnel,
    kpis: {} as BillingRecoveryOverview['kpis'],
  };
  const o = overview({
    funnel: { withdrawalFailed: { cases: 1, amount: 0, people: 1 } },
    cohort: [
      kase({ userId: 'after' }),
      kase({ userId: 'before', era: 'BEFORE_POLICY' }),
    ],
    beforePolicy: before,
  });

  it('범위를 바꾸면 퍼널과 건 목록이 함께 바뀐다', () => {
    expect(
      scopedOverview(o, 'UNDER').cohort.cases.map((c) => c.userId)
    ).toEqual(['after']);
    const b = scopedOverview(o, 'BEFORE');
    expect([
      b.funnel.withdrawalFailed.cases,
      b.cohort.cases.map((c) => c.userId),
    ]).toEqual([3, ['before']]);
  });

  it('시행 전 건이 섞인 달은 브리핑이 어느 쪽 숫자인지 밝힌다', () => {
    expect(briefing(o, 'UNDER')[0]).toBe(
      '10월(9/30 미납 정책 시행 후 시작분)에 출금이 실패한 청구 1건(1명)이 있었습니다.'
    );
    expect(briefing({ ...o, beforePolicy: null })[0]).toBe(
      '10월에 출금이 실패한 청구 1건(1명)이 있었습니다.'
    );
  });

  it('시행 전 실패뿐이라 알림이 없으면 «기록 없음»이 아니라 «대상 아님»', () => {
    const c = kase({ attemptNoticesBeforePolicy: [1] });
    expect(noNoticeBecauseBeforePolicy(c)).toBe(true);
    expect(noticeBadge(null, null, undefined, true).text).toBe(
      '시행 전 · 알림 대상 아님'
    );
    expect(
      noNoticeBecauseBeforePolicy(kase({ attemptNoticesMissing: [1] }))
    ).toBe(false);
  });
});
