/**
 * 출금 실패·미납 «건» 하나가 지금 어디에 있는지 판정하고, 판정한 건들을 화면 숫자로 묶는다.
 *
 * 건(case)은 두 갈래다.
 *  - WITHDRAWAL  인보이스 하나의 출금이 한 번 이상 실패한 것. 시작 = 첫 실패 시각.
 *  - MANDATE     출금을 해 보기도 전에 계좌 심사 거절로 해지된 것. 시작 = 해지 시각.
 *
 * 퍼널·보드·추이가 모두 이 파일의 판정을 쓴다 — 숫자마다 정의를 따로 두면 「칸에는 5건인데 카드는 4장」이 된다.
 * DB 를 모르는 순수 함수라 판정 규칙을 단위 테스트로 고정한다.
 */

/** 인보이스 경로의 최대 출금 시도 횟수. 마지막 시도의 실패는 해지로 이어진다. */
export const RECOVERY_MAX_ATTEMPTS = 3;

/**
 * 마지막 실패 뒤 이만큼 지나도 성공·해지 어느 쪽 결과도 안 왔으면 «재시도 중»이 아니라 «결과 안 옴»으로 본다.
 * 재시도 간격이 48시간이라 정상이면 이틀 안에 다음 결과가 온다 — 일주일은 넉넉한 여유다.
 */
export const AWAITING_RESULT_AFTER_DAYS = 7;

/** 다음 출금 시각을 기록하기 전의 실패에만 쓰는 추정 간격(wallet 기본 재시도 간격). */
export const ASSUMED_RETRY_INTERVAL_HOURS = 48;

export type RecoveryCaseKind = 'WITHDRAWAL' | 'MANDATE';

export type NoticeState = 'QUEUED' | 'SKIPPED';

export interface AttemptNoticeRecord {
  attemptNo: number;
  state: NoticeState;
  /** SKIPPED 일 때 이유(NO_PHONE 등) */
  reason: string | null;
}

export interface RecoveryCaseRow {
  kind: RecoveryCaseKind;
  contractId: string;
  userId: string;
  /** MANDATE 건은 해지 기록에 인보이스가 없어 null */
  invoiceId: string | null;
  startedAt: string;
  lastFailedAt: string | null;
  /** 지금까지 실패한 횟수(MANDATE 는 0) */
  attempts: number;
  /** 실패 한 번 한 번의 회차와 시각(오래된 순) */
  failures: Array<{ attemptNo: number; at: string }>;
  lastErrorCode: string | null;
  /** 은행이 준 마지막 실패 사유 원문(잔액부족 등) */
  lastErrorMessage: string | null;
  /** 실패 기록에 남은 다음 출금 시각. 그 칸이 생기기 전 실패는 null */
  nextAttemptAt: string | null;
  recoveredAt: string | null;
  recoveredAmount: number | null;
  terminatedAt: string | null;
  terminatedReason: string | null;
  contractStatus: string;
  /** 계약 요금제 정가 — 실패 단계의 금액은 이 값으로 추정한다 */
  planPrice: number;
  arrears: {
    id: string;
    amount: number;
    status: 'OUTSTANDING' | 'SETTLED' | 'WAIVED';
    paying: boolean;
    createdAt: string;
    settledAt: string | null;
  } | null;
  /** 해지됐는데 미납을 안 적은 이유(ARREARS_SKIPPED). 그 기록이 생기기 전 해지는 null */
  arrearsSkippedReason: string | null;
  attemptNotices: AttemptNoticeRecord[];
  finalNotice: { state: NoticeState; reason: string | null } | null;
}

export type RecoveryStage = 'RETRYING' | 'AWAITING_RESULT' | 'RECOVERED' | 'TERMINATED' | 'ENDED_OTHER';

/** 해지 원인. VOIDED(청구 취소)는 돈을 못 걷은 해지가 아니라서 미납 퍼널에 넣지 않는다. */
export type TerminationKind = 'EXHAUSTED' | 'MANDATE_REJECTED' | 'VOIDED' | 'OTHER';

/** 해지 뒤 돈의 상태 */
export type DebtState = 'OUTSTANDING' | 'PAYING' | 'SETTLED' | 'WAIVED' | 'NOT_RECORDED';

/**
 * 미납 정책·고객 알림이 시행되기 전에 시작된 건인가. 시행 전 건은 알림도 미납도 원래 대상이 아니라서,
 * 퍼널과 「알림 기록 없음」을 시행 후 건과 섞으면 놓친 것처럼 읽힌다.
 */
export type PolicyEra = 'BEFORE_POLICY' | 'UNDER_POLICY';

export interface ClassifiedCase extends RecoveryCaseRow {
  stage: RecoveryStage;
  era: PolicyEra;
  terminationKind: TerminationKind | null;
  debtState: DebtState | null;
  /** 남은 출금 기회(재시도 중일 때만 뜻이 있다) */
  remainingAttempts: number;
  /** 다음 출금 시각. estimated=true 면 기록이 없어 마지막 실패 + 기본 간격으로 짐작한 값 */
  nextAttempt: { at: string; estimated: boolean } | null;
  /** 알림이 나갔어야 하는데 아무 기록이 없는 회차 — 정책 시행 후의 실패만 센다 */
  attemptNoticesMissing: number[];
  /** 정책 시행 전에 실패해 알림 대상이 아니었던 회차 */
  attemptNoticesBeforePolicy: number[];
  /** 해지 안내가 나갔어야 하는가 — 정책 시행 후 돈을 못 걷어 해지된 건만 */
  finalNoticeExpected: boolean;
}

const DAY_MS = 86_400_000;

function terminationKindOf(reason: string | null): TerminationKind {
  if (!reason) return 'OTHER';
  if (reason.startsWith('UNCOLLECTIBLE')) return 'EXHAUSTED';
  if (reason.startsWith('MANDATE_REJECTED')) return 'MANDATE_REJECTED';
  if (reason.startsWith('INVOICE_VOIDED')) return 'VOIDED';
  return 'OTHER';
}

function debtStateOf(row: RecoveryCaseRow): DebtState {
  if (!row.arrears) return 'NOT_RECORDED';
  if (row.arrears.status === 'OUTSTANDING') return row.arrears.paying ? 'PAYING' : 'OUTSTANDING';
  return row.arrears.status;
}

/**
 * @param policyAt 미납 정책·고객 알림 시행 시각. 모르면(null) 경계 없이 모든 건을 시행 후로 본다.
 */
export function classifyCase(row: RecoveryCaseRow, now: Date, policyAt: Date | null = null): ClassifiedCase {
  const afterPolicy = (iso: string | null) => !policyAt || (iso != null && Date.parse(iso) >= policyAt.getTime());
  const remainingAttempts = Math.max(RECOVERY_MAX_ATTEMPTS - row.attempts, 0);

  let stage: RecoveryStage;
  let terminationKind: TerminationKind | null = null;
  if (row.recoveredAt) {
    stage = 'RECOVERED';
  } else if (row.terminatedAt) {
    stage = 'TERMINATED';
    terminationKind = row.kind === 'MANDATE' ? 'MANDATE_REJECTED' : terminationKindOf(row.terminatedReason);
  } else if (row.contractStatus === 'CANCELLED' || row.contractStatus === 'EXPIRED') {
    stage = 'ENDED_OTHER';
  } else if (row.lastFailedAt && now.getTime() - Date.parse(row.lastFailedAt) > AWAITING_RESULT_AFTER_DAYS * DAY_MS) {
    stage = 'AWAITING_RESULT';
  } else {
    stage = 'RETRYING';
  }

  const nonPayment = terminationKind === 'EXHAUSTED' || terminationKind === 'MANDATE_REJECTED';
  const debtState = nonPayment ? debtStateOf(row) : null;

  let nextAttempt: ClassifiedCase['nextAttempt'] = null;
  if (stage === 'RETRYING' && remainingAttempts > 0) {
    if (row.nextAttemptAt) nextAttempt = { at: row.nextAttemptAt, estimated: false };
    else if (row.lastFailedAt)
      nextAttempt = {
        at: new Date(Date.parse(row.lastFailedAt) + ASSUMED_RETRY_INTERVAL_HOURS * 3600_000).toISOString(),
        estimated: true,
      };
  }

  // 마지막 시도의 실패는 해지 안내가 대신하므로 1 ~ (최대-1) 회차만 회차 알림 대상이다.
  // 실패 시각을 모르는 회차(옛 기록)는 마지막 실패 시각으로 판정한다.
  const noticed = new Set(row.attemptNotices.map((n) => n.attemptNo));
  const failedAt = new Map(row.failures.map((f) => [f.attemptNo, f.at]));
  const attemptNoticesMissing: number[] = [];
  const attemptNoticesBeforePolicy: number[] = [];
  for (let n = 1; n <= Math.min(row.attempts, RECOVERY_MAX_ATTEMPTS - 1); n++) {
    if (noticed.has(n)) continue;
    if (afterPolicy(failedAt.get(n) ?? row.lastFailedAt)) attemptNoticesMissing.push(n);
    else attemptNoticesBeforePolicy.push(n);
  }

  return {
    ...row,
    stage,
    era: afterPolicy(row.startedAt) ? 'UNDER_POLICY' : 'BEFORE_POLICY',
    terminationKind,
    debtState,
    remainingAttempts,
    nextAttempt,
    attemptNoticesMissing,
    attemptNoticesBeforePolicy,
    finalNoticeExpected: nonPayment && afterPolicy(row.terminatedAt),
  };
}

// ─── 퍼널 ───────────────────────────────────────────────────────────────────

export interface CountAmount {
  cases: number;
  amount: number;
}

export interface RecoveryFunnel {
  /** 출금이 한 번 이상 실패한 건. 금액은 요금제 정가로 추정 */
  withdrawalFailed: CountAmount & { people: number };
  /** 재시도로 결국 걷은 건. 금액은 실제 받은 돈(기록 없는 건은 amountUnknownCases) */
  recovered: CountAmount & { amountUnknownCases: number };
  retrying: CountAmount & { lastChance: number };
  awaitingResult: CountAmount;
  /** 계약이 다른 이유(본인 해지·관리자 처리 등)로 먼저 끝난 건 */
  endedOther: CountAmount;
  voided: CountAmount;
  exhausted: CountAmount;
  /** 출금 전에 계좌 심사 거절로 해지된 건 */
  mandateRejected: CountAmount & { people: number };
  debt: {
    recorded: CountAmount;
    outstanding: CountAmount;
    paying: CountAmount;
    settled: CountAmount;
    waived: CountAmount;
    /** 해지됐지만 미납을 안 적은 건 — 이유별. 이유 기록이 생기기 전 건은 'UNRECORDED' */
    notRecorded: Record<string, number>;
  };
  notices: {
    attempt: { queued: number; skipped: number; missing: number };
    final: { queued: number; skipped: number; missing: number };
    /** 건너뛴 이유별 건수(NO_PHONE 등) */
    skippedReasons: Record<string, number>;
  };
}

export interface RecoveryKpis {
  /** 재시도로 걷은 비율 = 회수 ÷ (회수 + 재시도 소진 해지). 결과가 안 난 건은 빼고 따로 센다 */
  retryRecoveryRate: number | null;
  retryResolved: number;
  retryUnresolved: number;
  /** 미납으로 적힌 돈 중 받은 비율(금액) — 면제는 받은 것이 아니므로 분자에 넣지 않는다 */
  debtCollectionRate: number | null;
  /** 첫 실패부터 재시도 성공까지 평균 일수 */
  avgDaysToRecover: number | null;
  /** 미납이 생긴 뒤 받을 때까지 평균 일수 */
  avgDaysToSettle: number | null;
}

const zero = (): CountAmount => ({ cases: 0, amount: 0 });
const add = (c: CountAmount, amount: number) => {
  c.cases += 1;
  c.amount += amount;
};
const bump = (m: Record<string, number>, key: string) => {
  m[key] = (m[key] ?? 0) + 1;
};
const avg = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;

export function summarizeCases(cases: ClassifiedCase[]): { funnel: RecoveryFunnel; kpis: RecoveryKpis } {
  const funnel: RecoveryFunnel = {
    withdrawalFailed: { ...zero(), people: 0 },
    recovered: { ...zero(), amountUnknownCases: 0 },
    retrying: { ...zero(), lastChance: 0 },
    awaitingResult: zero(),
    endedOther: zero(),
    voided: zero(),
    exhausted: zero(),
    mandateRejected: { ...zero(), people: 0 },
    debt: {
      recorded: zero(),
      outstanding: zero(),
      paying: zero(),
      settled: zero(),
      waived: zero(),
      notRecorded: {},
    },
    notices: {
      attempt: { queued: 0, skipped: 0, missing: 0 },
      final: { queued: 0, skipped: 0, missing: 0 },
      skippedReasons: {},
    },
  };
  const failedPeople = new Set<string>();
  const mandatePeople = new Set<string>();
  const daysToRecover: number[] = [];
  const daysToSettle: number[] = [];

  for (const c of cases) {
    if (c.kind === 'WITHDRAWAL') {
      add(funnel.withdrawalFailed, c.planPrice);
      failedPeople.add(c.userId);
      switch (c.stage) {
        case 'RECOVERED':
          if (c.recoveredAmount == null) {
            funnel.recovered.cases += 1;
            funnel.recovered.amountUnknownCases += 1;
          } else add(funnel.recovered, c.recoveredAmount);
          if (c.recoveredAt) daysToRecover.push((Date.parse(c.recoveredAt) - Date.parse(c.startedAt)) / DAY_MS);
          break;
        case 'RETRYING':
          add(funnel.retrying, c.planPrice);
          if (c.remainingAttempts <= 1) funnel.retrying.lastChance += 1;
          break;
        case 'AWAITING_RESULT':
          add(funnel.awaitingResult, c.planPrice);
          break;
        case 'ENDED_OTHER':
          add(funnel.endedOther, c.planPrice);
          break;
        case 'TERMINATED':
          if (c.terminationKind === 'EXHAUSTED') add(funnel.exhausted, c.planPrice);
          else if (c.terminationKind === 'MANDATE_REJECTED') {
            add(funnel.mandateRejected, c.planPrice);
            mandatePeople.add(c.userId);
          } else if (c.terminationKind === 'VOIDED') add(funnel.voided, c.planPrice);
          else add(funnel.endedOther, c.planPrice);
          break;
      }
    } else {
      add(funnel.mandateRejected, c.planPrice);
      mandatePeople.add(c.userId);
    }

    if (c.debtState) {
      if (c.arrears) {
        add(funnel.debt.recorded, c.arrears.amount);
        const bucket =
          c.debtState === 'PAYING'
            ? funnel.debt.paying
            : c.debtState === 'SETTLED'
              ? funnel.debt.settled
              : c.debtState === 'WAIVED'
                ? funnel.debt.waived
                : funnel.debt.outstanding;
        add(bucket, c.arrears.amount);
        if (c.debtState === 'SETTLED' && c.arrears.settledAt)
          daysToSettle.push((Date.parse(c.arrears.settledAt) - Date.parse(c.arrears.createdAt)) / DAY_MS);
      } else {
        bump(funnel.debt.notRecorded, c.arrearsSkippedReason ?? 'UNRECORDED');
      }
    }

    for (const n of c.attemptNotices) {
      if (n.state === 'QUEUED') funnel.notices.attempt.queued += 1;
      else {
        funnel.notices.attempt.skipped += 1;
        bump(funnel.notices.skippedReasons, n.reason ?? 'UNKNOWN');
      }
    }
    funnel.notices.attempt.missing += c.attemptNoticesMissing.length;
    if (c.finalNoticeExpected) {
      if (!c.finalNotice) funnel.notices.final.missing += 1;
      else if (c.finalNotice.state === 'QUEUED') funnel.notices.final.queued += 1;
      else {
        funnel.notices.final.skipped += 1;
        bump(funnel.notices.skippedReasons, c.finalNotice.reason ?? 'UNKNOWN');
      }
    }
  }
  funnel.withdrawalFailed.people = failedPeople.size;
  funnel.mandateRejected.people = mandatePeople.size;

  const retryResolved = funnel.recovered.cases + funnel.exhausted.cases;
  const kpis: RecoveryKpis = {
    retryRecoveryRate: retryResolved > 0 ? funnel.recovered.cases / retryResolved : null,
    retryResolved,
    retryUnresolved: funnel.retrying.cases + funnel.awaitingResult.cases,
    debtCollectionRate:
      funnel.debt.recorded.amount > 0 ? funnel.debt.settled.amount / funnel.debt.recorded.amount : null,
    avgDaysToRecover: avg(daysToRecover),
    avgDaysToSettle: avg(daysToSettle),
  };
  return { funnel, kpis };
}

// ─── 주 단위 추이 ───────────────────────────────────────────────────────────

/** 한국 시간 월요일 0시(UTC 순간) — 그 순간이 속한 주의 시작 */
export function kstWeekStart(at: Date): Date {
  const kst = new Date(at.getTime() + 9 * 3600_000);
  const dow = (kst.getUTCDay() + 6) % 7; // 월=0
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - dow) - 9 * 3600_000);
}

export interface WeeklyPoint {
  /** 그 주 월요일(KST) 날짜 'YYYY-MM-DD' */
  week: string;
  failedCases: number;
  recoveredCases: number;
  terminatedCases: number;
  debtCreated: number;
  debtSettled: number;
  debtWaived: number;
}

export interface ArrearsMovement {
  amount: number;
  status: 'OUTSTANDING' | 'SETTLED' | 'WAIVED';
  createdAt: string;
  settledAt: string | null;
}

export function weeklyTrend(
  cases: ClassifiedCase[],
  arrears: ArrearsMovement[],
  now: Date,
  weeks: number,
): WeeklyPoint[] {
  const first = kstWeekStart(new Date(now.getTime() - (weeks - 1) * 7 * DAY_MS));
  const points: WeeklyPoint[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = new Date(first.getTime() + i * 7 * DAY_MS);
    points.push({
      week: new Date(start.getTime() + 9 * 3600_000).toISOString().slice(0, 10),
      failedCases: 0,
      recoveredCases: 0,
      terminatedCases: 0,
      debtCreated: 0,
      debtSettled: 0,
      debtWaived: 0,
    });
  }
  const index = (iso: string | null): number => {
    if (!iso) return -1;
    const i = Math.floor((Date.parse(iso) - first.getTime()) / (7 * DAY_MS));
    return i >= 0 && i < weeks ? i : -1;
  };

  for (const c of cases) {
    if (c.kind === 'WITHDRAWAL') {
      const i = index(c.startedAt);
      if (i >= 0) points[i].failedCases += 1;
    }
    const r = index(c.stage === 'RECOVERED' ? c.recoveredAt : null);
    if (r >= 0) points[r].recoveredCases += 1;
    if (c.terminationKind === 'EXHAUSTED' || c.terminationKind === 'MANDATE_REJECTED') {
      const t = index(c.terminatedAt);
      if (t >= 0) points[t].terminatedCases += 1;
    }
  }
  for (const a of arrears) {
    const c = index(a.createdAt);
    if (c >= 0) points[c].debtCreated += a.amount;
    const s = index(a.settledAt);
    if (s >= 0) {
      if (a.status === 'SETTLED') points[s].debtSettled += a.amount;
      if (a.status === 'WAIVED') points[s].debtWaived += a.amount;
    }
  }
  return points;
}
